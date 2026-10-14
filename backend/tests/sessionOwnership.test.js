const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const Session = require('../models/Session');
const User = require('../models/User');
const { assertAuthTarget, verifyAuthConnection } = require('./authIsolation');
const target = assertAuthTarget(process.env);
const mockCreate = jest.fn();
jest.mock('../lib/llmClient', () => ({
  getGroqClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('pino', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return () => logger;
});
const app = express();
app.use(express.json());
app.use('/v1/auth', require('../routes/authRoutes'));
app.use(require('../routes/sessionRoutes'));
app.use(require('../routes/chatRoutes'));
app.use(require('../routes/assessmentRoutes'));
app.use(require('../routes/quizRoutes'));
let owner, other, session;
const userIds = [], sessionIds = [];
const authorization = account => `Bearer ${account.accessToken}`;

describe('session ownership across chat and session APIs', () => {
  beforeAll(async () => {
    await verifyAuthConnection(mongoose.connection, target);
    for (const username of ['ownership_owner', 'ownership_other']) {
      const result = await request(app).post('/v1/auth/signup').send({
        username, name: 'Ownership Test', password: 'Password123!',
      }).expect(201);
      userIds.push(result.body.data.user._id);
      if (!owner) owner = result.body.data;
      else other = result.body.data;
    }
  });
  beforeEach(async () => {
    mockCreate.mockClear();
    session = await Session.create({
      userId: owner.user._id, topic: 'Private topic', chatTitle: 'Private chat',
      phase: 'completed', isViewOnly: true,
      profile: { source: 'user', name: 'Owner', background: 'Student', goals: ['Learn'],
        strengths: ['Practice'], gaps: ['Basics'], timePerDayMins: 30, preferredStyle: 'mixed' },
      messages: [{ id: 'private-message', role: 'assistant', content: 'Private content' }],
    });
    sessionIds.push(session._id);
  });
  afterAll(async () => {
    await verifyAuthConnection(mongoose.connection, target);
    await Session.deleteMany({ _id: { $in: sessionIds } });
    await User.deleteMany({ _id: { $in: userIds } });
  });

  // Exercise every session operation, including routes that already have ownership checks.
  test.each([
    ['get', ''], ['get', '/messages'], ['post', '/resume'], ['post', '/summarize'],
    ['patch', ''], ['patch', '/favorite'], ['delete', ''],
  ])('another user cannot %s a session%s, and the stored document is unchanged', async (method, suffix) => {
    const before = await Session.findById(session._id).lean();
    const response = await request(app)[method](`/v1/sessions/${session._id}${suffix}`)
      .set('Authorization', authorization(other)).send({ chatTitle: 'Hijacked', isFavorite: true }).expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(await Session.findById(session._id).lean()).toEqual(before);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test.each([false, true])('another user cannot chat or change mode (stream=%s)', async stream => {
    const before = await Session.findById(session._id).lean();
    const response = await request(app).post('/v1/chat').set('Authorization', authorization(other))
      .send({ sessionId: session._id.toString(), userMessage: 'Show private history', mode: 'reviewing', stream }).expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(await Session.findById(session._id).lean()).toEqual(before);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test.each(['/v1/assessment', '/v1/assessment/approve', '/v1/assessment/modify',
    '/v1/quiz/start', '/v1/quiz/submit', '/v1/quiz/revision'])('another user cannot mutate a session through %s', async endpoint => {
    const before = await Session.findById(session._id).lean();
    await request(app).post(endpoint).set('Authorization', authorization(other))
      .send({ sessionId: session._id.toString(), moduleId: '1', userMessage: 'Learn JavaScript', modificationRequest: 'Change plan', answers: [{ id: 'q1', userIndex: 0 }], topic: 'JavaScript' }).expect(403);
    expect(await Session.findById(session._id).lean()).toEqual(before);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test.each(['/v1/sessions', '/v1/sessions?search=Private', '/v1/sessions/search?q=Private'])(
    '%s lists only the authenticated user sessions', async endpoint => {
      session.mode = 'reviewing';
      await session.save();
      const own = await request(app).get(endpoint).set('Authorization', authorization(owner)).expect(200);
      expect(own.body.data.sessions.map(item => item.id)).toContain(session._id.toString());
      const foreign = await request(app).get(endpoint).set('Authorization', authorization(other)).expect(200);
      expect(foreign.body.data.sessions).toEqual([]);
      expect(foreign.body.data.total).toBe(0);
    }
  );

  test('owner retains read, messages, rename, favorite and delete contracts', async () => {
    const url = `/v1/sessions/${session._id}`;
    const own = req => req.set('Authorization', authorization(owner));
    const read = await own(request(app).get(url)).expect(200);
    expect(read.body.data.userId).toBe(owner.user._id);
    await own(request(app).get(`${url}/messages`)).expect(200);
    const rename = await own(request(app).patch(url)).send({ chatTitle: 'Renamed' }).expect(200);
    expect(rename.body.data.chatTitle).toBe('Renamed');
    await own(request(app).patch(`${url}/favorite`)).send({ isFavorite: true }).expect(200);
    const removal = await own(request(app).delete(url)).expect(200);
    expect(removal.body).toEqual({ success: true, data: { id: session._id.toString() } });
    expect(await Session.findById(session._id)).toBeNull();
  });

  test('owner can reach the existing completed-chat response', async () => {
    const response = await request(app).post('/v1/chat').set('Authorization', authorization(owner))
      .send({ sessionId: session._id.toString(), userMessage: 'continue' }).expect(200);
    expect(response.body.success).toBe(true);
  });

  test('anonymous chat is rejected and unknown or malformed IDs retain their status', async () => {
    await request(app).post('/v1/chat').send({ sessionId: session._id.toString(), userMessage: 'continue' }).expect(401);
    const own = req => req.set('Authorization', authorization(owner));
    await own(request(app).post('/v1/chat')).send({ sessionId: new mongoose.Types.ObjectId().toString(), userMessage: 'continue' }).expect(404);
    await own(request(app).post('/v1/chat')).send({ sessionId: 'invalid', userMessage: 'continue' }).expect(400);
  });

  test('sessions without an owner fail closed', async () => {
    await Session.collection.updateOne({ _id: session._id }, { $unset: { userId: '' } });
    await request(app).post('/v1/chat').set('Authorization', authorization(owner))
      .send({ sessionId: session._id.toString(), userMessage: 'continue' }).expect(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

});
