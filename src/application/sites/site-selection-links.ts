export const selectionPath=(token:string)=>`/selecao/${token}`;
export const selectionUrl=(token:string)=>`${(process.env.PUBLIC_APP_URL||"https://vorixworks.com").replace(/\/$/,"")}${selectionPath(token)}`;
