import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const files = ['01-notification-dispatcher.json', '02-sos-and-daily-reports.json'];
const workflows = files.map(file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')));
let checks = 0;
function check(fn) { fn(); checks++; }

for (const workflow of workflows) {
  check(() => assert.equal(workflow.active, false));
  check(() => assert.equal(workflow.settings.timezone, 'Asia/Kolkata'));
  const names = new Set(workflow.nodes.map(n => n.name));
  check(() => assert.equal(names.size, workflow.nodes.length));
  check(() => assert.equal(new Set(workflow.nodes.map(n => n.id)).size, workflow.nodes.length));
  for (const [from, outputs] of Object.entries(workflow.connections)) {
    check(() => assert.ok(names.has(from), `Unknown connection source ${from}`));
    for (const routes of outputs.main) for (const route of routes) {
      check(() => assert.ok(names.has(route.node), `Unknown destination ${route.node}`));
    }
  }
  for (const node of workflow.nodes) {
    if (node.parameters.jsCode) {
      check(() => assert.doesNotThrow(() => new Function('$json', '$input', '$', '$execution', node.parameters.jsCode), node.name));
    }
    const scan = value => {
      if (typeof value === 'string' && value.startsWith('={{') && value.endsWith('}}')) {
        const expr = value.slice(3, -2);
        check(() => assert.doesNotThrow(() => new Function('$json', '$input', '$', '$execution', `return (${expr});`), `${node.name}: expression`));
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(scan);
      }
    };
    scan(node.parameters);
    if (node.type === 'n8n-nodes-base.httpRequest' && node.name !== 'Send Teams alert') {
      check(() => assert.equal(node.parameters.genericAuthType, 'httpCustomAuth'));
      check(() => assert.equal(node.parameters.options.redirect.redirect.followRedirects, false));
    }
  }
}

const dispatcher = workflows[0];
const get = name => dispatcher.nodes.find(n => n.name === name);
function run(name, json, job = null, config = {baseUrl: 'https://cab.example', fromEmail: 'cab@company.example', limit: 5}) {
  const source = get(name).parameters.jsCode;
  return new Function('$json', '$input', '$', '$execution', source)(
    json, {first: () => ({json})},
    node => node === 'Configuration' ? {first: () => ({json: config})} : {item: {json: job}},
    {id: 'validation-only'}
  );
}
const emailJob = {id: 'job-1', leaseToken: 'nonsecret-test-lease', channel: 'email', payload: {to: ['admin@company.example'], text: 'SOS test', subject: 'SOS test', priority: 'high'}};
const teamsJob = {id: 'job-2', leaseToken: 'nonsecret-test-lease-2', channel: 'teams', payload: {teamId: 'team', channelId: 'channel', text: 'SOS test', priority: 'high'}};

check(() => assert.deepEqual(run('Split claimed jobs', {jobs: []}), []));
check(() => assert.throws(() => run('Split claimed jobs', {ok: true}), /unexpected claim response/));
check(() => assert.equal(run('Split claimed jobs', {jobs: [emailJob, teamsJob]}).length, 2));
check(() => assert.equal(run('Prepare delivery', emailJob).json.validationError, ''));
check(() => assert.equal(run('Prepare delivery', teamsJob).json.validationError, ''));
check(() => assert.throws(() => run('Prepare delivery', {...emailJob, leaseToken: null}), /lease token/));
check(() => assert.match(run('Prepare delivery', {...emailJob, payload: {...emailJob.payload, to: []}}).json.validationError, /one valid recipient/));
check(() => assert.match(run('Prepare delivery', {...emailJob, payload: {...emailJob.payload, to: ['a@example.com','b@example.com']}}).json.validationError, /one valid recipient/));
check(() => assert.match(run('Prepare delivery', {...teamsJob, payload: {...teamsJob.payload, channelId: ''}}).json.validationError, /channel ID/));
check(() => assert.match(run('Prepare delivery', {...emailJob, payload: {...emailJob.payload, subject: 'Subject\nBcc: attacker@example.com'}}).json.validationError, /line break/));
check(() => assert.equal(run('Teams result', {statusCode: 201, body: {id: 'teams-message'}}, teamsJob).json.status, 'sent'));
check(() => assert.equal(run('Teams result', {statusCode: 403, body: {error: {message: 'Permission denied'}}}, teamsJob).json.status, 'failed'));
check(() => assert.equal(run('Teams result', {statusCode: 201, body: {}}, teamsJob).json.status, 'failed'));
check(() => assert.equal(run('Teams result', {error: {message: 'Timeout'}}, teamsJob).json.status, 'failed'));
check(() => assert.equal(run('Email result', {messageId: 'mail-message', accepted: ['admin@company.example'], rejected: []}, emailJob).json.status, 'sent'));
check(() => assert.equal(run('Email result', {messageId: 'mail-message', accepted: ['someone-else@company.example'], rejected: []}, emailJob).json.status, 'failed'));
check(() => assert.equal(run('Email result', {messageId: 'mail-message', accepted: [], rejected: ['admin@company.example']}, emailJob).json.status, 'failed'));
check(() => assert.equal(run('Email result', {error: {message: 'SMTP unavailable'}}, emailJob).json.status, 'failed'));
check(() => assert.equal(run('Teams result', {error: 'x'.repeat(1000)}, teamsJob).json.error.length, 600));
check(() => assert.deepEqual(dispatcher.connections['Loop deliveries'].main[1].map(n => n.node), ['Prepare delivery']));
check(() => assert.deepEqual(dispatcher.connections['Record delivery result'].main[0].map(n => n.node), ['Loop deliveries']));
check(() => assert.equal(get('Loop deliveries').parameters.batchSize, 1));
check(() => assert.ok(!get('Send Teams alert').retryOnFail));
check(() => assert.ok(!get('Send email alert').retryOnFail));
check(() => assert.equal(get('Record delivery result').retryOnFail, true));

console.log(`PASS: ${checks} structure, syntax, routing and result-classification checks.`);
console.log('No network requests or real notifications were sent. Live n8n import and provider tests remain required.');
