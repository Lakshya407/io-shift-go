declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    SETUP_TOKEN?: string;
    SITE_URL?: string;
    AUTOMATION_API_KEY?: string;
    N8N_WEBHOOK_URL?: string;
    N8N_WEBHOOK_SECRET?: string;
    AZURE_AD_TENANT_ID?: string;
    AZURE_AD_CLIENT_ID?: string;
    AZURE_AD_CLIENT_SECRET?: string;
    AZURE_AD_REDIRECT_URI?: string;
  }
}
