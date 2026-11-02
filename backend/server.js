import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

const app = express();
const httpServer = http.createServer(app);
const port = Number(process.env.PORT) || 4000;
const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '1mb' }));

const io = new Server(httpServer, {
  cors: { origin: allowedOrigin, methods: ['GET', 'POST'] }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'FULE Protect API' });
});

// MVP stand-in for an OpenAI call: produces a predictable structured summary
// from the latest transcript/chat text. Replace this function with a model API
// call when credentials and a reviewed safety workflow are available.
function createIncidentSummary(logs = '') {
  const text = String(logs).slice(-4000);
  const mentionsHelp = /help|follow|unsafe|threat|stalk|emergency|scared|stop/i.test(text);
  return {
    threat_level: 'CRITICAL',
    summary: text.trim()
      ? `Last 15 seconds: ${text.slice(-280)}${text.length > 280 ? '…' : ''}`
      : 'SOS triggered. No transcript supplied; verify the person’s safety and location immediately.',
    recommended_action: mentionsHelp ? 'DISPATCH_MODS' : 'DISPATCH_MODS'
  };
}

app.post('/api/sos', (req, res) => {
  const { latitude, longitude, victimStatus, liveStreamUrl, transcript, chatLog } = req.body ?? {};
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
  }

  const alert = {
    id: `sos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    location: { latitude: lat, longitude: lng },
    victimStatus: String(victimStatus || 'SOS triggered; status unknown').slice(0, 240),
    liveStreamUrl: typeof liveStreamUrl === 'string' ? liveStreamUrl.slice(0, 1000) : '',
    incidentSummary: createIncidentSummary(transcript ?? chatLog)
  };

  io.emit('sos:alert', alert);
  return res.status(201).json({ ok: true, alert });
});

io.on('connection', (socket) => {
  console.log(`Guardian connected: ${socket.id}`);
  socket.on('incident:acknowledge', (incidentId) => {
    io.emit('incident:acknowledged', {
      incidentId: String(incidentId),
      moderatorId: socket.id,
      acknowledgedAt: new Date().toISOString()
    });
  });
  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

httpServer.listen(port, () => {
  console.log(`FULE Protect API listening at http://localhost:${port}`);
});
