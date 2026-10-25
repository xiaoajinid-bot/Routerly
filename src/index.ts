import Fastify from 'fastify';
import { startServer } from '../packages/service/dist/server.js';

await startServer(Fastify);
