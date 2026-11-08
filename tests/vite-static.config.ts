import config from '../vite.config'
// Exercise the browser app with no local agent proxy, like a static deployment.
export default { ...config, server: { host: '127.0.0.1', port: 43130, hmr: false } }
