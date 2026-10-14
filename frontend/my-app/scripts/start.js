// Keep CRA's existing development server and proxy, with a valid host allowlist.
process.env.BABEL_ENV = 'development';
process.env.NODE_ENV = 'development';
require('react-scripts/config/env');
if (process.env.DANGEROUSLY_DISABLE_HOST_CHECK === 'true') {
  throw new Error('Host checks must remain enabled. Configure HOST instead.');
}
process.env.HOST = process.env.HOST || '127.0.0.1';
const configPath = require.resolve('react-scripts/config/webpackDevServer.config');
const createConfig = require(configPath);
require.cache[configPath].exports = (proxy, allowedHost) => {
  const config = createConfig(proxy, allowedHost);
  const hosts = ['localhost', '127.0.0.1', '[::1]'];
  for (const host of [process.env.HOST, allowedHost]) {
    if (host && host !== '0.0.0.0' && host !== '::') hosts.push(host);
  }
  return { ...config, allowedHosts: [...new Set(hosts)] };
};
require('react-scripts/scripts/start');
