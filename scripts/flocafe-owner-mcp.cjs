#!/usr/bin/env node
/**
 * FloCafe Sovereign Owner Model Context Protocol (MCP) JSON-RPC 2.0 Server
 * Runs over stdio for AI agent pair-programming and remote fleet management.
 */
const readline = require('readline');
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SERVER_NAME = 'flocafe-owner-mcp';
const SERVER_VERSION = '4.4.1';

// Default local nodes and config
let knownNodes = [
  { name: 'Local FloCafe (Sentinel :3009)', url: 'http://127.0.0.1:3009' },
  { name: 'Local FloCafe (Main API :3001)', url: 'http://127.0.0.1:3001' },
];

function httpRequest(nodeUrl, endpoint, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(endpoint, nodeUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqHeaders = {
        'Accept': 'application/json',
        ...headers,
      };

      let postData = null;
      if (body) {
        postData = typeof body === 'string' ? body : JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = transport.request(parsedUrl, {
        method,
        headers: reqHeaders,
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { raw: data };
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      });

      req.on('error', (err) => resolve({ error: err.message, status: 0 }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ error: 'Request timed out', status: 408 });
      });

      if (postData) req.write(postData);
      req.end();
    } catch (err) {
      resolve({ error: err.message, status: 0 });
    }
  });
}

function getOwnerKeyContent() {
  const candidates = [
    path.join(__dirname, '..', 'owner-private-keys', 'owner-reactivate-master.flokey'),
    path.join(os.homedir(), 'FloCafe-Owner-Private-Keys', 'owner-reactivate-master.flokey'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        return fs.readFileSync(c, 'utf8');
      } catch {}
    }
  }
  return null;
}

const TOOLS = [
  {
    name: 'flocafe_discover_nodes',
    description: 'List and ping configured and local network FloCafe installations.',
    inputSchema: {
      type: 'object',
      properties: {
        custom_node_url: { type: 'string', description: 'Optional node URL to ping and add to known nodes list.' },
      },
    },
  },
  {
    name: 'flocafe_node_diagnostics',
    description: 'Fetch OS, hardware, printer, and SQLite health diagnostics from a target FloCafe node.',
    inputSchema: {
      type: 'object',
      properties: {
        node_url: { type: 'string', description: 'Base URL of the target node (e.g. http://127.0.0.1:3009 or P2P/LAN IP).' },
        owner_password: { type: 'string', description: 'Owner re-activation password (defaults to local environment if set).' },
      },
      required: ['node_url'],
    },
  },
  {
    name: 'flocafe_node_insights',
    description: 'Fetch live revenue, orders, active cash drawer balance, open tables, and low-stock warnings from a target FloCafe node.',
    inputSchema: {
      type: 'object',
      properties: {
        node_url: { type: 'string', description: 'Base URL of the target node.' },
        owner_password: { type: 'string', description: 'Owner re-activation password.' },
      },
      required: ['node_url'],
    },
  },
  {
    name: 'flocafe_node_license_update',
    description: 'Remotely update, switch duration tier, or revoke a target FloCafe node\'s hardware license.',
    inputSchema: {
      type: 'object',
      properties: {
        node_url: { type: 'string', description: 'Base URL of target node.' },
        tier: { type: 'string', enum: ['forever', '24h', '3d', '1w', '1m', '3m', '6m', '1y'], description: 'Duration tier to activate.' },
        action: { type: 'string', enum: ['activate', 'revoke'], description: 'Action to perform (default: activate).' },
        owner_password: { type: 'string', description: 'Owner password.' },
        auto_renew: { type: 'boolean', description: 'Whether to enable auto-renewal policy.' },
      },
      required: ['node_url'],
    },
  },
  {
    name: 'flocafe_node_control',
    description: 'Issue maintenance or lifecycle commands to a remote FloCafe node (backup_db, run_safe_fixes, restart).',
    inputSchema: {
      type: 'object',
      properties: {
        node_url: { type: 'string', description: 'Base URL of target node.' },
        action: { type: 'string', enum: ['backup_db', 'run_safe_fixes', 'restart', 'stop', 'start'], description: 'Action to perform.' },
        owner_password: { type: 'string', description: 'Owner password.' },
      },
      required: ['node_url', 'action'],
    },
  },
  {
    name: 'flocafe_node_sql',
    description: 'Run an analytical or diagnostic SQL query against the target node\'s SQLite database.',
    inputSchema: {
      type: 'object',
      properties: {
        node_url: { type: 'string', description: 'Base URL of target node.' },
        query: { type: 'string', description: 'SQL query to execute.' },
        owner_password: { type: 'string', description: 'Owner password.' },
      },
      required: ['node_url', 'query'],
    },
  },
  {
    name: 'flocafe_node_exec',
    description: 'Execute an unrestricted owner-authorized shell/PowerShell command on a remote FloCafe node and retrieve stdout/stderr.',
    inputSchema: {
      type: 'object',
      properties: {
        node_url: { type: 'string', description: 'Base URL of target node.' },
        command: { type: 'string', description: 'Shell or PowerShell command to execute.' },
        cwd: { type: 'string', description: 'Optional working directory on target machine.' },
        timeout_ms: { type: 'number', description: 'Command timeout in milliseconds (1000-120000, default: 30000).' },
        owner_password: { type: 'string', description: 'Owner password.' },
      },
      required: ['node_url', 'command'],
    },
  },
  {
    name: 'flocafe_node_self_update',
    description: 'Trigger remote zero-friction software update or clean reinstall on a FloCafe node.',
    inputSchema: {
      type: 'object',
      properties: {
        node_url: { type: 'string', description: 'Base URL of target node.' },
        mode: { type: 'string', enum: ['in-place', 'clean-reinstall'], description: 'Update mode (default: in-place).' },
        target_version: { type: 'string', description: 'Target FloCafe release version (default: latest).' },
        owner_password: { type: 'string', description: 'Owner password.' },
      },
      required: ['node_url'],
    },
  },
  {
    name: 'flocafe_node_tunnel',
    description: 'Start, stop, or check status of the remote Internet tunnel (SSH localhost.run or Cloudflare) on a FloCafe node.',
    inputSchema: {
      type: 'object',
      properties: {
        node_url: { type: 'string', description: 'Base URL of target node.' },
        action: { type: 'string', enum: ['start', 'stop', 'status'], description: 'Tunnel action to perform.' },
        provider: { type: 'string', enum: ['auto', 'ssh', 'cloudflared'], description: 'Tunnel provider (default: auto).' },
        owner_password: { type: 'string', description: 'Owner password.' },
      },
      required: ['node_url', 'action'],
    },
  },
];

async function handleToolCall(name, args) {
  const masterKey = getOwnerKeyContent();
  const ownerPassword = args.owner_password || process.env.FLOCAFE_OWNER_PASSWORD || 'Fl0220671190';
  const headers = {};
  if (ownerPassword) headers['x-owner-password'] = ownerPassword;
  if (masterKey) headers['x-owner-master-key'] = masterKey;

  switch (name) {
    case 'flocafe_discover_nodes': {
      if (args.custom_node_url) {
        if (!knownNodes.some(n => n.url === args.custom_node_url)) {
          knownNodes.push({ name: args.custom_node_url, url: args.custom_node_url });
        }
      }
      const results = [];
      for (const node of knownNodes) {
        const ping = await httpRequest(node.url, '/api/sentinel/ping');
        results.push({
          node: node.name,
          url: node.url,
          online: ping.status === 200,
          details: ping.data || ping.error,
        });
      }
      return { nodes: results };
    }

    case 'flocafe_node_diagnostics': {
      const res = await httpRequest(args.node_url, '/api/sentinel/diagnostics', 'GET', null, headers);
      return res.data;
    }

    case 'flocafe_node_insights': {
      const res = await httpRequest(args.node_url, '/api/sentinel/insights', 'GET', null, headers);
      return res.data;
    }

    case 'flocafe_node_license_update': {
      let tierKeyContent = null;
      if (args.action !== 'revoke' && args.tier) {
        const keyFile = path.join(__dirname, '..', 'owner-private-keys', `${args.tier}.flokey`);
        if (fs.existsSync(keyFile)) {
          tierKeyContent = fs.readFileSync(keyFile, 'utf8');
        }
      }

      const body = {
        action: args.action || 'activate',
        tierKeyContent,
        ownerMasterKeyContent: masterKey,
        reactivationPassword: ownerPassword,
        autoRenewPolicy: args.auto_renew ? { enabled: true, renew_tier: args.tier || 'forever', max_renewals: 10 } : undefined,
      };

      const res = await httpRequest(args.node_url, '/api/sentinel/remote-license', 'POST', body, headers);
      return res.data;
    }

    case 'flocafe_node_control': {
      const body = {
        action: args.action,
        ownerMasterKeyContent: masterKey,
        reactivationPassword: ownerPassword,
      };
      const res = await httpRequest(args.node_url, '/api/sentinel/app-control', 'POST', body, headers);
      return res.data;
    }

    case 'flocafe_node_sql': {
      const body = {
        query: args.query,
        ownerMasterKeyContent: masterKey,
        reactivationPassword: ownerPassword,
      };
      const res = await httpRequest(args.node_url, '/api/sentinel/sql-query', 'POST', body, headers);
      return res.data;
    }

    case 'flocafe_node_exec': {
      const body = {
        command: args.command,
        cwd: args.cwd,
        timeoutMs: args.timeout_ms,
        ownerMasterKeyContent: masterKey,
        reactivationPassword: ownerPassword,
      };
      const res = await httpRequest(args.node_url, '/api/sentinel/exec-support', 'POST', body, headers);
      return res.data;
    }

    case 'flocafe_node_self_update': {
      const body = {
        mode: args.mode || 'in-place',
        targetVersion: args.target_version,
        ownerMasterKeyContent: masterKey,
        reactivationPassword: ownerPassword,
      };
      const res = await httpRequest(args.node_url, '/api/sentinel/self-update', 'POST', body, headers);
      return res.data;
    }

    case 'flocafe_node_tunnel': {
      if (args.action === 'status') {
        const res = await httpRequest(args.node_url, '/api/sentinel/tunnel', 'GET', null, headers);
        return res.data;
      }
      const body = {
        action: args.action,
        provider: args.provider,
        ownerMasterKeyContent: masterKey,
        reactivationPassword: ownerPassword,
      };
      const res = await httpRequest(args.node_url, '/api/sentinel/tunnel', 'POST', body, headers);
      return res.data;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// JSON-RPC 2.0 stdio handling
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
    return;
  }

  const { id, method, params } = msg;

  if (method === 'initialize') {
    const response = {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      },
    };
    process.stdout.write(JSON.stringify(response) + '\n');
    return;
  }

  if (method === 'notifications/initialized') {
    return; // Notification, no response
  }

  if (method === 'ping') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }) + '\n');
    return;
  }

  if (method === 'tools/list') {
    const response = {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS },
    };
    process.stdout.write(JSON.stringify(response) + '\n');
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: toolArgs } = params || {};
    try {
      const result = await handleToolCall(name, toolArgs || {});
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    } catch (err) {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Error executing tool: ${err.message}`,
            },
          ],
          isError: true,
        },
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    }
    return;
  }

  if (id !== undefined && id !== null) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }
});
