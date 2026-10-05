export type StorageProvider = 'SUPABASE' | 'GOOGLE_DRIVE';
export type FileStage = 'Draft' | 'Proof' | 'Approved' | 'Print Ready' | 'Archived';
export type OperationState = 'queued' | 'running' | 'retry' | 'done' | 'failed' | 'unknown';
export interface OperationResult { operation_id: string; state: OperationState; }
export interface StoragePolicy {
  threshold_bytes: number; max_file_bytes: number;
  drive_extensions: string[]; drive_mime_types: string[]; drive_purposes: string[];
}
export interface UploadRequest {
  ticket_id: string; asset_id?: string; idempotency_key: string;
  filename: string; mime_type: string; size_bytes: number; purpose: string; production_source_file?: boolean;
}
export interface UploadSession {
  session_id: string; file_id: string; asset_id: string; provider: StorageProvider;
  state: 'pending' | 'uploading' | 'complete' | 'failed'; confirmed_offset: number;
  size_bytes: number; chunk_bytes: number; expires_at: string;
}
export interface EmailRequest {
  inbox_id: string; ticket_id?: string; idempotency_key: string;
  to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string;
  thread_id?: string; in_reply_to?: string; references?: string;
}
export interface VendorRequest {
  ticket_id: string; file_id: string; vendor_id: string; inbox_id: string;
  idempotency_key: string; access_hours?: number; override_reason?: string;
}
export interface GmailServiceContract {
  sendEmail(request: EmailRequest): Promise<OperationResult>;
  sendAsAlias(request: EmailRequest): Promise<OperationResult>;
  syncEmails(request: { idempotency_key: string }): Promise<OperationResult>;
  getEmail(request: { message_id: string }): Promise<unknown>;
  getThread(request: { message_id: string }): Promise<unknown>;
  attachEmailToCustomer(request: { message_id: string; customer_id: string }): Promise<unknown>;
  attachEmailToTicket(request: { message_id: string; ticket_id: string }): Promise<unknown>;
}
export interface FileEngineContract {
  beginUpload(request: UploadRequest): Promise<UploadSession>;
  resumeUpload(request: { session_id: string }): Promise<UploadSession>;
  completeUpload(request: { session_id: string }): Promise<UploadSession>;
  reuseFile(request: { file_id: string; ticket_id: string }): Promise<unknown>;
  setCurrentVersion(request: { file_id: string }): Promise<unknown>;
  approveForProduction(request: { file_id: string; ticket_id: string }): Promise<unknown>;
}
export interface VendorServiceContract {
  sendToVendor(request: VendorRequest): Promise<OperationResult>;
  revokeVendorAccess(request: { delivery_id: string; idempotency_key: string }): Promise<OperationResult | { revoked: boolean }>;
  expireVendorAccess(request: { delivery_id: string; idempotency_key: string }): Promise<OperationResult | { revoked: boolean }>;
  resendVendorLink(request: { delivery_id: string; idempotency_key: string }): Promise<OperationResult>;
}
