"""Generate secret-free, importable n8n workflows for ShiftGo Cab.

Run this file only when intentionally updating the checked-in workflow exports.
Configuration values in already-imported n8n workflows remain n8n-owned.
"""
import json
from pathlib import Path
from uuid import uuid5, NAMESPACE_URL

HERE = Path(__file__).parent

def node(name, type_name, version, position, parameters, **extra):
    return dict(id=str(uuid5(NAMESPACE_URL, "nightshift-cab/" + name)), name=name,
                type="n8n-nodes-base." + type_name, typeVersion=version,
                position=position, parameters=parameters, **extra)

def code(name, pos, source, mode="runOnceForEachItem"):
    return node(name, "code", 2, pos, {"mode": mode, "jsCode": source})

APP_CRED = {"httpCustomAuth": {"id": "CONFIGURE_CAB_APP_CUSTOM_AUTH", "name": "Cab app automation API"}}
TEAMS_CRED = {"microsoftTeamsOAuth2Api": {"id": "CONFIGURE_MICROSOFT_TEAMS_OAUTH2", "name": "Cab admin Microsoft Teams"}}
MAIL_CRED = {"smtp": {"id": "CONFIGURE_CAB_ALERTS_SMTP", "name": "Cab alerts SMTP"}}
HOOK_CRED = {"httpHeaderAuth": {"id": "CONFIGURE_CAB_WAKEUP_HEADER_AUTH", "name": "Cab wake-up webhook"}}

config_js = r"""// Non-secret deployment settings. Never paste credentials here.
const baseUrl = 'https://nightshift-cab-care.noblebuddy257.chatgpt.site';
const fromEmail = 'cab-alerts@YOUR-COMPANY.example';
if (!/^https:\/\//.test(baseUrl) || /YOUR-CAB-APP/.test(baseUrl)) {
  throw new Error('Set the HTTPS app URL in Configuration before activating this workflow.');
}
return [{json: {baseUrl: baseUrl.replace(/\/$/, ''), fromEmail, limit: 5}}];"""

def app_request(name, position, url, body):
    return node(name, "httpRequest", 4.2, position, {
        "method": "POST", "url": url,
        "authentication": "genericCredentialType", "genericAuthType": "httpCustomAuth",
        "sendBody": True, "specifyBody": "json", "jsonBody": body,
        "options": {"timeout": 30000, "redirect": {"redirect": {"followRedirects": False}},
                    "response": {"response": {"responseFormat": "json"}}}
    }, credentials=APP_CRED)

def condition(name, position, left, right):
    return node(name, "if", 2.2, position, {
        "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
                       "conditions": [{"id": str(uuid5(NAMESPACE_URL,name)), "leftValue": left, "rightValue": right,
                                       "operator": {"type": "string", "operation": "equals"}}], "combinator": "and"},
        "options": {}
    })

def edge(connections, source, target, output=0):
    outputs = connections.setdefault(source, {"main": []})["main"]
    while len(outputs) <= output: outputs.append([])
    outputs[output].append({"node": target, "type": "main", "index": 0})

split_js = """const result = $input.first().json;
if (!result || !Array.isArray(result.jobs)) {
  throw new Error('Cab API returned an unexpected claim response; expected {jobs: []}.');
}
return result.jobs.map(job => ({json: job, pairedItem: {item: 0}}));"""

prepare_js = """const job = $json;
const config = $('Configuration').first().json;
if (!job.id || !job.leaseToken) throw new Error('Claimed job missing identity or lease token.');
const p = job.payload || {};
let validationError = '';
if (!['teams', 'email'].includes(job.channel)) validationError = 'Unsupported notification channel.';
else if (typeof p.text !== 'string' || !p.text.trim()) validationError = 'Notification text is missing.';
else if (job.channel === 'teams' && (!p.teamId || !p.channelId)) validationError = 'Teams team or channel ID is missing.';
else if (job.channel === 'email' && (!Array.isArray(p.to) || p.to.length !== 1 || !/^[^\\s@,;]+@[^\\s@,;]+\\.[^\\s@,;]+$/.test(p.to[0]))) validationError = 'Email jobs require one valid recipient per job.';
else if (job.channel === 'email' && (/YOUR-COMPANY/.test(config.fromEmail) || !config.fromEmail.includes('@'))) validationError = 'Configure the workflow From email address.';
else if (job.channel === 'email' && (!p.subject || /[\\r\\n]/.test(p.subject))) validationError = 'Email subject is empty or contains a line break.';
return {json: {...job, payload: p, validationError, fromEmail: config.fromEmail}};"""

teams_receipt_js = """const job = $('Prepare delivery').item.json;
const response = $json;
const body = response.body || {};
const ok = response.statusCode === 201 && Boolean(body.id) && !response.error;
const reason = response.error?.message || response.error || body.error?.message || `Teams returned HTTP ${response.statusCode || 'unknown'} without a created message ID.`;
return {json: {id: job.id, leaseToken: job.leaseToken, status: ok ? 'sent' : 'failed',
  providerId: ok ? String(body.id) : null,
  error: ok ? null : String(reason).slice(0, 600)}};"""

email_receipt_js = """const job = $('Prepare delivery').item.json;
const response = $json;
const addresses = values => Array.isArray(values) ? values.map(v => String(typeof v === 'string' ? v : v.address || '').toLowerCase()) : [];
const accepted = addresses(response.accepted);
const rejected = addresses(response.rejected);
const ok = !response.error && Boolean(response.messageId) && rejected.length === 0 && job.payload.to.every(a => accepted.includes(a.toLowerCase()));
const reason = response.error?.message || response.error || (rejected.length ? 'SMTP rejected the recipient.' : 'SMTP did not confirm acceptance for this recipient.');
return {json: {id: job.id, leaseToken: job.leaseToken, status: ok ? 'sent' : 'failed',
  providerId: ok ? String(response.messageId) : null,
  error: ok ? null : String(reason).slice(0, 600)}};"""

invalid_receipt_js = """return {json: {id: $json.id, leaseToken: $json.leaseToken, status: 'failed', providerId: null, error: $json.validationError}};"""

dispatcher_nodes = [
    node("Recovery poll · every 30 seconds", "scheduleTrigger", 1.2, [-920,-160], {"rule":{"interval":[{"field":"seconds","secondsInterval":30}]}}),
    node("Immediate wake-up", "webhook", 2, [-920,40], {"httpMethod":"POST","path":"cab-notification-wakeup","authentication":"headerAuth","responseMode":"onReceived","responseCode":202,"options":{}}, webhookId="76a1a620-30e4-48ed-8494-286ba652574f", credentials=HOOK_CRED),
    node("Manual dispatch", "manualTrigger", 1, [-920,240], {}),
    code("Configuration", [-680,20], config_js, "runOnceForAllItems"),
    app_request("Lease pending jobs", [-440,20], "={{ $json.baseUrl + '/api/automation/jobs/claim' }}", "={{ JSON.stringify({limit: $json.limit, workerId: 'n8n-' + $execution.id}) }}"),
    code("Split claimed jobs", [-200,20], split_js, "runOnceForAllItems"),
    node("Loop deliveries", "splitInBatches", 3, [40,20], {"batchSize":1,"options":{}}),
    code("Prepare delivery", [280,20], prepare_js),
    condition("Valid job?", [520,20], "={{ $json.validationError }}", ""),
    condition("Teams channel?", [760,-120], "={{ $json.channel }}", "teams"),
    node("Send Teams alert", "httpRequest", 4.2, [1020,-240], {
        "method":"POST", "url":"={{ 'https://graph.microsoft.com/v1.0/teams/' + encodeURIComponent($json.payload.teamId) + '/channels/' + encodeURIComponent($json.payload.channelId) + '/messages' }}",
        "authentication":"predefinedCredentialType", "nodeCredentialType":"microsoftTeamsOAuth2Api",
        "sendBody":True, "specifyBody":"json",
        "jsonBody":"={{ JSON.stringify({body:{contentType:$json.payload.html ? 'html' : 'text',content:$json.payload.html || $json.payload.text},importance:$json.payload.priority === 'high' ? 'high' : 'normal'}) }}",
        "options":{"timeout":30000,"response":{"response":{"fullResponse":True,"neverError":True,"responseFormat":"json"}},"redirect":{"redirect":{"followRedirects":False}}}
    }, credentials=TEAMS_CRED, onError="continueRegularOutput"),
    node("Send email alert", "emailSend", 2.1, [1020,0], {
        "fromEmail":"={{ $json.fromEmail }}", "toEmail":"={{ $json.payload.to.join(',') }}", "subject":"={{ $json.payload.subject }}",
        "emailFormat":"both", "text":"={{ $json.payload.text }}",
        "html":"={{ $json.payload.html || ('<pre>' + $json.payload.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>') }}",
        "options":{"appendAttribution":False}
    }, credentials=MAIL_CRED, onError="continueRegularOutput"),
    code("Teams result", [1260,-240], teams_receipt_js),
    code("Email result", [1260,0], email_receipt_js),
    code("Invalid job result", [1020,260], invalid_receipt_js),
    app_request("Record delivery result", [1520,20], "={{ $('Configuration').first().json.baseUrl + '/api/automation/jobs/' + encodeURIComponent($json.id) + '/receipt' }}", "={{ JSON.stringify({leaseToken:$json.leaseToken,status:$json.status,providerId:$json.providerId,error:$json.error}) }}"),
    node("Setup and delivery semantics", "stickyNote", 1, [-700,-540], {"content":"## Configure before publishing\n1. Set app URL and sender in Configuration.\n2. Select Cab API Custom Auth, Teams OAuth2, SMTP, and webhook Header Auth credentials.\n3. Set app N8N_WEBHOOK_URL + N8N_WEBHOOK_SECRET.\n4. Run supervised tests, then publish both workflows.\n\nApp database owns retries. Provider acceptance is not admin acknowledgment. An uncertain provider result can cause a duplicate on retry. See README.md.","height":300,"width":600})
]
dispatcher_nodes[-2]["retryOnFail"] = True
dispatcher_nodes[-2]["maxTries"] = 3
dispatcher_nodes[-2]["waitBetweenTries"] = 1000
dispatcher_connections = {}
for trigger in ["Recovery poll · every 30 seconds", "Immediate wake-up", "Manual dispatch"]:
    edge(dispatcher_connections, trigger, "Configuration")
for a,b in [("Configuration","Lease pending jobs"),("Lease pending jobs","Split claimed jobs"),("Split claimed jobs","Loop deliveries"),("Prepare delivery","Valid job?"),("Valid job?","Teams channel?"),("Teams channel?","Send Teams alert"),("Send Teams alert","Teams result"),("Send email alert","Email result"),("Teams result","Record delivery result"),("Email result","Record delivery result"),("Invalid job result","Record delivery result")]:
    edge(dispatcher_connections,a,b)
edge(dispatcher_connections,"Loop deliveries","Prepare delivery",1)
edge(dispatcher_connections,"Record delivery result","Loop deliveries")
edge(dispatcher_connections,"Valid job?","Invalid job result",1)
edge(dispatcher_connections,"Teams channel?","Send email alert",1)

tick_nodes = [
    node("Every minute", "scheduleTrigger", 1.2, [-420,0], {"rule":{"interval":[{"field":"minutes","minutesInterval":1}]}}),
    node("Manual maintenance", "manualTrigger", 1, [-420,180], {}),
    code("Configuration", [-180,0], config_js, "runOnceForAllItems"),
    app_request("Generate due reminders and reports", [80,0], "={{ $json.baseUrl + '/api/automation/tick' }}", "={{ JSON.stringify({workerId:'n8n-maintenance-' + $execution.id}) }}"),
    node("How timing works", "stickyNote", 1, [-180,-360], {"content":"## App-owned timing\nThe app decides which SOS reminders and daily reports are due, using the admin's settings and Asia/Kolkata by default. Tick is idempotent.\n\nThis workflow queues messages; the Notification Dispatcher sends them. No AI is used for routing or emergency decisions.\n\nConfigure the same app URL and Custom Auth credential as the dispatcher, then publish.","height":260,"width":560})
]
tick_connections = {}
for trigger in ["Every minute", "Manual maintenance"]: edge(tick_connections,trigger,"Configuration")
edge(tick_connections,"Configuration","Generate due reminders and reports")

def workflow(name,nodes,connections):
    return {"name":name,"nodes":nodes,"connections":connections,"active":False,
            "settings":{"executionOrder":"v1","timezone":"Asia/Kolkata","saveDataErrorExecution":"all","saveDataSuccessExecution":"none","saveExecutionProgress":False,"executionTimeout":240},
            "pinData":{},"tags":[],"meta":{"templateCredsSetupCompleted":False}}

for filename,body in [
    ("01-notification-dispatcher.json",workflow("ShiftGo Cab · Notification Dispatcher",dispatcher_nodes,dispatcher_connections)),
    ("02-sos-and-daily-reports.json",workflow("ShiftGo Cab · SOS Escalation and Daily Reports",tick_nodes,tick_connections))
]:
    (HERE/filename).write_text(json.dumps(body,indent=2,ensure_ascii=False)+"\n")
    print(filename)
