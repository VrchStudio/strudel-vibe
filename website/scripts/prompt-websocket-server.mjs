#!/usr/bin/env node

import http from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer } from 'ws';

const DEFAULT_PORT = 8001;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_CHANNEL = '1';

const port = Number(process.env.PROMPT_WS_PORT) || DEFAULT_PORT;
const host = process.env.PROMPT_WS_HOST || DEFAULT_HOST;

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Strudel prompt relay running.\n');
});

const channels = new Map();

const getChannelClients = (channel) => {
  let clients = channels.get(channel);
  if (!clients) {
    clients = new Set();
    channels.set(channel, clients);
  }
  return clients;
};

const removeClientFromChannel = (channel, ws) => {
  const clients = channels.get(channel);
  if (!clients) {
    return;
  }
  clients.delete(ws);
  if (clients.size === 0) {
    channels.delete(channel);
  }
};

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request, channel) => {
  const clients = getChannelClients(channel);
  clients.add(ws);

  console.log(
    `[prompt-ws] client connected from ${request.socket.remoteAddress || 'unknown'} on channel ${channel}`,
  );

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      return;
    }
    const text = typeof data === 'string' ? data : data.toString('utf8');
    if (!text) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      // ignore malformed payloads but keep connection alive
      return;
    }

    if (typeof parsed?.prompt === 'string' && parsed.prompt.trim()) {
      console.log('[prompt-ws] prompt received:', parsed.prompt.trim());
    }

    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(text);
      }
    }
  });

  ws.on('close', () => {
    removeClientFromChannel(channel, ws);
    console.log('[prompt-ws] client disconnected from channel', channel);
  });

  ws.on('error', (error) => {
    console.warn('[prompt-ws] client error', error);
  });
});

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/json') {
      socket.destroy();
      return;
    }

    const channel = url.searchParams.get('channel') || DEFAULT_CHANNEL;

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, channel);
    });
  } catch (upgradeError) {
    console.warn('[prompt-ws] upgrade error', upgradeError);
    socket.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`[prompt-ws] listening on ws://${host}:${port}/json?channel=<id>`);
});
