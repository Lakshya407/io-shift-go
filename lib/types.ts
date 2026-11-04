export type LocationData={status:string;lat?:number;lng?:number;accuracy?:number;capturedAt?:string};
export type OfficeLocation={id:string;name:string;region:string};
export const defaultLocations:OfficeLocation[]=[
 {id:'noida',name:'Noida office',region:'Noida, Uttar Pradesh'},
 {id:'pune',name:'Pune office',region:'Pune, Maharashtra'},
 {id:'dehradun',name:'Dehradun office',region:'Dehradun, Uttarakhand'},
];
export const defaultSettings={companyName:'Your Company',appName:'ShiftGo',brandColor:'#19746b',fontFamily:'Inter',logoUrl:'',supportText:'Your safe journey, one tap at a time.',boardLabel:"I'm in the cab",homeLabel:'Reached home',officeLabel:'Reached office',emergencyPhone:'',adminEmails:[] as string[],sosEmails:[] as string[],reportRecipients:[] as string[],teamsTeamId:'',teamsChannelId:'',sosTeamsChannelId:'',reportHour:9,reportMinute:0,shiftCutoffHour:8,timezone:'Asia/Kolkata',escalationMinutes:5,maxEscalations:3,retentionDays:180,locations:defaultLocations};
export type Settings=typeof defaultSettings;
export type Employee={id:string;employee_code:string;name:string;email:string;phone:string;department:string;role:string;active:number;password_hash:string;must_change_password:number;created_at:string;updated_at:string;location:string;last_active_at:string|null;deleted_at:string|null;sso_subject:string|null};
export type Row=Record<string,any>;

/** RBAC permission catalog. 'admin' has every permission; 'employee' has none (employee app only). */
export const PERMISSIONS=[
 {key:'dashboard.view',label:'View dashboard & journeys',description:'Overview, live journeys and trip details.'},
 {key:'alerts.manage',label:'Handle SOS alerts',description:'Acknowledge and resolve SOS alerts; view and retry notifications.'},
 {key:'employees.manage',label:'Manage employees',description:'Add, edit, deactivate and delete employee accounts.'},
 {key:'reports.view',label:'View reports',description:'Daily reports and CSV exports.'},
 {key:'settings.manage',label:'Manage settings',description:'Company, branding, locations, notification recipients and schedules.'},
 {key:'automations.manage',label:'Manage automations',description:'n8n integration tokens and maintenance.'},
 {key:'rbac.manage',label:'Manage access control',description:'Create roles, grant permissions and change user roles.'},
] as const;
export type Permission=typeof PERMISSIONS[number]['key'];
export const ALL_PERMISSIONS=PERMISSIONS.map(p=>p.key) as Permission[];
export const BUILTIN_ROLES=[
 {id:'admin',name:'Admin',description:'Full access to everything, including access control.',permissions:ALL_PERMISSIONS,builtin:true},
 {id:'employee',name:'User',description:'Uses the employee app only: check-in, arrival and SOS.',permissions:[] as Permission[],builtin:true},
];
