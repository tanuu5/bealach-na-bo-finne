import { startServer } from './static-server.mjs';

const port = Number(process.env.PORT || process.argv[2] || 5173);
const { port: actual } = await startServer(port);
console.log(`Serving on http://localhost:${actual}/`);
