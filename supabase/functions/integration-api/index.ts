import { cors, environment, service, jsonBody, errorReply } from '../_shared/integrations/runtime.ts';
import { fail, uuid } from '../_shared/integrations/core.mjs';
import { readLimited } from '../_shared/integrations/google.mjs';

const actions: Record<string,string>={status:'status',saveMailSignature:'saveMailSignature',listMailDrafts:'listMailDrafts',saveMailDraft:'saveMailDraft',getMailDraft:'getMailDraft',deleteMailDraft:'deleteMailDraft',setEmailState:'setEmailState',configureMail:'configureMail',processMailOperation:'processMailOperation',configure:'configure',beginOAuth:'beginOAuth',validateAliases:'validateAliases',disconnect:'disconnect',
  libraryStatus:'libraryStatus',configureLibrary:'configureLibrary',beginLibraryIdentity:'beginLibraryIdentity',beginLibraryUpload:'beginLibraryUpload',directUploadSession:'directUploadSession',listLibraryFiles:'listLibraryFiles',findLibraryDuplicate:'findLibraryDuplicate',directFileAccess:'directFileAccess',resolveThumbnails:'resolveThumbnails',requestLibraryPreview:'requestLibraryPreview',
  saveInbox:'saveInbox',setInboxAccess:'setInboxAccess',sendEmail:'sendEmail',sendAsAlias:'sendEmail',syncEmails:'syncEmails',listEmails:'listEmails',
  getEmail:'getEmail',getThread:'getThread',listLinkedEmails:'listLinkedEmails',attachEmailToCustomer:'attachEmail',attachEmailToTicket:'attachEmail',
  beginUpload:'beginUpload',resumeUpload:'resumeUpload',completeUpload:'completeUpload',listFiles:'listFiles',customerHistory:'customerHistory',
  reuseFile:'reuseFile',setFileStage:'setFileStage',setCurrentVersion:'setCurrentVersion',approveForProduction:'approveForProduction',
  getFileAccess:'getFileAccess',saveVendor:'saveVendor',listVendors:'listVendors',sendToVendor:'sendToVendor',
  revokeVendorAccess:'revokeVendorAccess',expireVendorAccess:'revokeVendorAccess',resendVendorLink:'resendVendorLink',retryOperation:'retryOperation',operationStatus:'operationStatus',
  reconcileGrant:'reconcileGrant'};

Deno.serve(async(req:Request)=>{
  let headers:Record<string,string>={};
  try {
    headers=cors(req,environment()); if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
    const s=await service(req),url=new URL(req.url),binary=url.searchParams.get('binary');
    if(binary) {
      const session_id=url.searchParams.get('session_id'),file_id=url.searchParams.get('file_id');
      const input={session_id,file_id,offset:Number(url.searchParams.get('offset')),mime_type:req.headers.get('content-type'),source_bucket:url.searchParams.get('source_bucket'),source_path:url.searchParams.get('source_path'),variant:url.searchParams.get('variant')};
      if(!['uploadChunk','smallUpload','previewUpload','downloadFile','registerThumbnail'].includes(binary))fail('INVALID_ACTION');
      if(binary==='downloadFile') {
        const {f}=await s.file(uuid(file_id));if(f.availability!=='available')fail('FILE_UNAVAILABLE',409);
        if(f.storage_provider!=='GOOGLE_DRIVE')fail('INVALID_STORAGE_PROVIDER');
        const g=await s.google(),meta=await g.stat(f.drive_file_id);
        if(meta.trashed||Number(meta.size)!==Number(f.size_bytes)||(f.checksum&&meta.md5Checksum!==f.checksum))fail('ORIGINAL_CHANGED_EXTERNALLY',409);
        const response=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.drive_file_id)}?alt=media`,{
          headers:{Authorization:`Bearer ${g.token}`},signal:AbortSignal.timeout(120000)});
        if(!response.ok)fail('FILE_DOWNLOAD_FAILED',502);
        // Stream original without buffering. Caller must use authenticated fetch,
        // never a JWT in URL. Object remains in Drive.
        return new Response(response.body,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`}});
      }
      const bytes=await readLimited(req,binary==='registerThumbnail'?131072:binary==='smallUpload'?52428800:binary==='previewUpload'?1048576:4194304);
      const invoke=(s as unknown as Record<string,(input:unknown,bytes:Uint8Array)=>Promise<unknown>>)[binary];
      const result=await invoke.call(s,input,bytes);return Response.json(result,{headers});
    }
    const input=await jsonBody(req),method=actions[input.action];if(!method)fail('INVALID_ACTION');
    const invoke=(s as unknown as Record<string,(input:unknown)=>Promise<unknown>>)[method];
    return Response.json(await invoke.call(s,input),{headers});
  }catch(e){return errorReply(e,headers);}
});
