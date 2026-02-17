/**
 * ALIN Prepared Statements
 * All 90+ prepared statements for performance — user-scoped queries filter by user_id.
 */

export function createStatements(db) {
  return {
    // Conversations
    insertConversation: db.prepare(`INSERT INTO conversations (id,title,mode,model,provider,metadata,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?)`),
    getConversation: db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?'),
    listConversations: db.prepare(`SELECT id,title,mode,model,provider,is_favorite,is_archived,is_pinned,created_at,updated_at,(SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) as message_count,(SELECT content FROM messages WHERE conversation_id=c.id ORDER BY timestamp DESC LIMIT 1) as last_message FROM conversations c WHERE is_archived=? AND user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?`),
    updateConversation: db.prepare(`UPDATE conversations SET title=?,mode=?,model=?,provider=?,is_favorite=?,is_archived=?,is_pinned=?,metadata=?,updated_at=? WHERE id=? AND user_id=?`),
    deleteConversation: db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?'),
    searchConversations: db.prepare(`SELECT DISTINCT c.id,c.title,c.updated_at,c.mode FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE c.user_id=? AND (m.content LIKE ? OR c.title LIKE ?) ORDER BY c.updated_at DESC LIMIT ?`),

    // Messages
    insertMessage: db.prepare(`INSERT INTO messages (id,conversation_id,role,content,tokens_input,tokens_output,cost,model,is_edited,parent_id,metadata,timestamp,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    getMessages: db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND user_id=? ORDER BY timestamp ASC`),
    updateMessage: db.prepare(`UPDATE messages SET content=?,is_edited=1,metadata=? WHERE id=? AND user_id=?`),
    deleteMessage: db.prepare('DELETE FROM messages WHERE id = ? AND user_id = ?'),

    // TBWO Receipts
    insertReceipt: db.prepare(`INSERT INTO tbwo_receipts (id,tbwo_id,receipt_type,data,created_at,user_id) VALUES (?,?,?,?,?,?)`),
    getReceipts: db.prepare('SELECT * FROM tbwo_receipts WHERE tbwo_id=? AND user_id=? ORDER BY created_at DESC'),

    // Settings (per-user via user_settings table)
    upsertSetting: db.prepare(`INSERT INTO user_settings (user_id,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`),
    getAllSettings: db.prepare('SELECT * FROM user_settings WHERE user_id=?'),

    // TBWO Orders
    insertTBWO: db.prepare(`INSERT INTO tbwo_orders (id,type,status,objective,time_budget_total,quality_target,scope,plan,pods,active_pods,artifacts,checkpoints,authority_level,progress,receipts,chat_conversation_id,started_at,completed_at,metadata,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    getTBWO: db.prepare('SELECT * FROM tbwo_orders WHERE id = ? AND user_id = ?'),
    listTBWOs: db.prepare('SELECT * FROM tbwo_orders WHERE user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?'),
    updateTBWO: db.prepare(`UPDATE tbwo_orders SET type=?,status=?,objective=?,time_budget_total=?,quality_target=?,scope=?,plan=?,pods=?,active_pods=?,artifacts=?,checkpoints=?,authority_level=?,progress=?,receipts=?,chat_conversation_id=?,started_at=?,completed_at=?,metadata=?,execution_state=?,updated_at=? WHERE id=? AND user_id=?`),
    deleteTBWO: db.prepare('DELETE FROM tbwo_orders WHERE id = ? AND user_id = ?'),

    // Artifacts
    insertArtifact: db.prepare(`INSERT INTO artifacts (id,title,type,language,content,editable,conversation_id,tbwo_id,metadata,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    getArtifact: db.prepare('SELECT * FROM artifacts WHERE id = ? AND user_id = ?'),
    listArtifacts: db.prepare('SELECT * FROM artifacts WHERE user_id=? ORDER BY updated_at DESC LIMIT ?'),
    listArtifactsByConversation: db.prepare('SELECT * FROM artifacts WHERE conversation_id=? AND user_id=? ORDER BY updated_at DESC LIMIT ?'),
    listArtifactsByTBWO: db.prepare('SELECT * FROM artifacts WHERE tbwo_id=? AND user_id=? ORDER BY updated_at DESC LIMIT ?'),
    updateArtifact: db.prepare(`UPDATE artifacts SET title=?,type=?,language=?,content=?,editable=?,metadata=?,updated_at=? WHERE id=? AND user_id=?`),
    deleteArtifact: db.prepare('DELETE FROM artifacts WHERE id = ? AND user_id = ?'),

    // Memory Entries
    insertMemory: db.prepare(`INSERT INTO memory_entries (id,layer,content,salience,decay_rate,access_count,is_consolidated,is_archived,is_pinned,user_modified,tags,related_memories,edit_history,metadata,last_accessed_at,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    getMemory: db.prepare('SELECT * FROM memory_entries WHERE id = ? AND user_id = ?'),
    listMemories: db.prepare('SELECT * FROM memory_entries WHERE user_id=? ORDER BY salience DESC'),
    listMemoriesByLayer: db.prepare('SELECT * FROM memory_entries WHERE layer=? AND user_id=? ORDER BY salience DESC'),
    updateMemory: db.prepare(`UPDATE memory_entries SET layer=?,content=?,salience=?,decay_rate=?,access_count=?,is_consolidated=?,is_archived=?,is_pinned=?,user_modified=?,tags=?,related_memories=?,edit_history=?,metadata=?,last_accessed_at=?,updated_at=? WHERE id=? AND user_id=?`),
    deleteMemory: db.prepare('DELETE FROM memory_entries WHERE id = ? AND user_id = ?'),

    // Audit Entries
    insertAudit: db.prepare(`INSERT INTO audit_entries (id,conversation_id,message_id,model,tokens_prompt,tokens_completion,tokens_total,cost,tools_used,duration_ms,timestamp,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    listAudit: db.prepare('SELECT * FROM audit_entries WHERE user_id=? ORDER BY timestamp DESC LIMIT ?'),
    listAuditSince: db.prepare('SELECT * FROM audit_entries WHERE user_id=? AND timestamp>=? ORDER BY timestamp DESC'),
    pruneAudit: db.prepare('DELETE FROM audit_entries WHERE user_id=? AND timestamp < ?'),

    // Images
    insertImage: db.prepare(`INSERT INTO images (id,url,prompt,revised_prompt,model,size,quality,style,conversation_id,message_id,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    listImages: db.prepare('SELECT * FROM images WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),
    deleteImage: db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?'),

    // Sites
    insertSite: db.prepare(`INSERT INTO sites (id,user_id,project_id,name,tbwo_run_id,status,cloudflare_project_name,domain,manifest,storage_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    getSite: db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?'),
    listSites: db.prepare('SELECT * FROM sites WHERE user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?'),
    updateSite: db.prepare('UPDATE sites SET name=?,status=?,cloudflare_project_name=?,domain=?,manifest=?,updated_at=? WHERE id=? AND user_id=?'),
    deleteSite: db.prepare('DELETE FROM sites WHERE id = ? AND user_id = ?'),
    deleteDeploymentsBySite: db.prepare('DELETE FROM deployments WHERE site_id = ? AND user_id = ?'),
    deletePatchesBySite: db.prepare('DELETE FROM site_patches WHERE site_id = ? AND user_id = ?'),

    // Deployments
    insertDeployment: db.prepare(`INSERT INTO deployments (id,site_id,user_id,cloudflare_project_name,cloudflare_deployment_id,url,status,build_log,error,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`),
    listDeployments: db.prepare('SELECT * FROM deployments WHERE site_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?'),
    updateDeploymentStatus: db.prepare('UPDATE deployments SET status=?,cloudflare_deployment_id=?,url=?,build_log=?,error=? WHERE id=? AND user_id=?'),

    // Site Patches
    insertPatch: db.prepare(`INSERT INTO site_patches (id,site_id,user_id,change_request,plan,status,created_at) VALUES (?,?,?,?,?,?,?)`),
    getPatch: db.prepare('SELECT * FROM site_patches WHERE id = ? AND user_id = ?'),
    listPatches: db.prepare('SELECT * FROM site_patches WHERE site_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?'),
    updatePatch: db.prepare('UPDATE site_patches SET plan=?,status=?,apply_result=?,resolved_at=? WHERE id=? AND user_id=?'),

    // Self-Model: Execution Outcomes
    insertOutcome: db.prepare(`INSERT INTO execution_outcomes (id,tbwo_id,objective,type,time_budget,plan_confidence,phases_completed,phases_failed,artifacts_count,user_edits_after,quality_score,timestamp,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    listOutcomes: db.prepare('SELECT * FROM execution_outcomes WHERE user_id=? ORDER BY timestamp DESC LIMIT ?'),
    listOutcomesByType: db.prepare('SELECT * FROM execution_outcomes WHERE user_id=? AND type=? ORDER BY timestamp DESC LIMIT ?'),

    // Self-Model: Tool Reliability (shared)
    getToolReliability: db.prepare('SELECT * FROM tool_reliability ORDER BY (success_count + failure_count) DESC'),
    upsertToolReliability: db.prepare(`INSERT INTO tool_reliability (tool_name, success_count, failure_count, avg_duration, common_errors, last_failure_reason)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tool_name) DO UPDATE SET
        success_count = tool_reliability.success_count + excluded.success_count,
        failure_count = tool_reliability.failure_count + excluded.failure_count,
        avg_duration = (tool_reliability.avg_duration * (tool_reliability.success_count + tool_reliability.failure_count) + excluded.avg_duration) / (tool_reliability.success_count + tool_reliability.failure_count + 1),
        common_errors = CASE WHEN excluded.last_failure_reason != '' THEN excluded.common_errors ELSE tool_reliability.common_errors END,
        last_failure_reason = CASE WHEN excluded.last_failure_reason != '' THEN excluded.last_failure_reason ELSE tool_reliability.last_failure_reason END`),

    // Self-Model: Model Success Rates
    getModelSuccessRates: db.prepare('SELECT model, success_count, failure_count, (success_count + failure_count) as total_calls, avg_duration FROM model_success_rates WHERE model != \'unknown\' ORDER BY total_calls DESC'),
    upsertModelSuccessRate: db.prepare(`INSERT INTO model_success_rates (model, success_count, failure_count, avg_duration, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(model) DO UPDATE SET
        success_count = model_success_rates.success_count + excluded.success_count,
        failure_count = model_success_rates.failure_count + excluded.failure_count,
        avg_duration = (model_success_rates.avg_duration * (model_success_rates.success_count + model_success_rates.failure_count) + excluded.avg_duration) / (model_success_rates.success_count + model_success_rates.failure_count + 1),
        updated_at = excluded.updated_at`),

    // Self-Model: User Corrections
    insertCorrection: db.prepare(`INSERT INTO user_corrections (id, original_value, corrected_value, category, correction_count, last_corrected, user_id) VALUES (?,?,?,?,1,?,?)`),
    findCorrection: db.prepare('SELECT * FROM user_corrections WHERE category=? AND corrected_value=? AND user_id=? LIMIT 1'),
    incrementCorrection: db.prepare('UPDATE user_corrections SET correction_count = correction_count + 1, last_corrected = ? WHERE id = ? AND user_id = ?'),
    listCorrections: db.prepare('SELECT * FROM user_corrections WHERE user_id=? AND correction_count >= ? ORDER BY correction_count DESC'),

    // Self-Model: Decision Log
    insertDecision: db.prepare(`INSERT INTO decision_log (id,tbwo_id,decision_type,options_considered,chosen_option,reasoning,outcome,confidence,timestamp,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)`),
    listDecisions: db.prepare('SELECT * FROM decision_log WHERE user_id=? ORDER BY timestamp DESC LIMIT ?'),
    listDecisionsByTBWO: db.prepare('SELECT * FROM decision_log WHERE user_id=? AND tbwo_id=? ORDER BY timestamp DESC LIMIT ?'),

    // Self-Model: Thinking Traces
    insertThinkingTrace: db.prepare(`INSERT INTO thinking_traces (id,conversation_id,message_id,tbwo_id,thinking_content,timestamp,user_id) VALUES (?,?,?,?,?,?,?)`),
    listThinkingByConv: db.prepare('SELECT * FROM thinking_traces WHERE conversation_id=? AND user_id=? ORDER BY timestamp ASC'),
    listThinkingByTBWO: db.prepare('SELECT * FROM thinking_traces WHERE tbwo_id=? AND user_id=? ORDER BY timestamp ASC'),
    searchThinking: db.prepare('SELECT * FROM thinking_traces WHERE user_id=? AND thinking_content LIKE ? ORDER BY timestamp DESC LIMIT ?'),

    // Self-Model: Layer Memory
    insertLayerMemory: db.prepare(`INSERT INTO memory_layers (id,layer,content,category,salience,expires_at,metadata,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)`),
    listLayerMemories: db.prepare('SELECT * FROM memory_layers WHERE layer=? AND user_id=? AND (expires_at IS NULL OR expires_at > ?) ORDER BY salience DESC LIMIT ?'),
    pruneExpiredLayers: db.prepare('DELETE FROM memory_layers WHERE user_id=? AND expires_at IS NOT NULL AND expires_at < ?'),
    deleteLayerMemory: db.prepare('DELETE FROM memory_layers WHERE id = ? AND user_id = ?'),

    // Site Versions
    insertSiteVersion: db.prepare(`INSERT INTO site_versions (id,site_id,user_id,version,file_count,total_bytes,deployment_id,created_at) VALUES (?,?,?,?,?,?,?,?)`),
    listSiteVersions: db.prepare('SELECT * FROM site_versions WHERE site_id=? AND user_id=? ORDER BY version DESC LIMIT ?'),
    getLatestVersion: db.prepare('SELECT * FROM site_versions WHERE site_id=? AND user_id=? ORDER BY version DESC LIMIT 1'),

    // CF Images
    insertCfImage: db.prepare(`INSERT INTO cf_images (id,user_id,cf_image_id,filename,url,variants,metadata,site_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)`),
    listCfImages: db.prepare('SELECT * FROM cf_images WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),
    getCfImage: db.prepare('SELECT * FROM cf_images WHERE id=? AND user_id=?'),
    deleteCfImage: db.prepare('DELETE FROM cf_images WHERE id=? AND user_id=?'),

    // CF Videos
    insertCfVideo: db.prepare(`INSERT INTO cf_videos (id,user_id,cf_uid,status,thumbnail,preview,duration,metadata,site_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`),
    listCfVideos: db.prepare('SELECT * FROM cf_videos WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),
    getCfVideo: db.prepare('SELECT * FROM cf_videos WHERE id=? AND user_id=?'),
    updateCfVideo: db.prepare('UPDATE cf_videos SET status=?,thumbnail=?,preview=?,duration=? WHERE id=? AND user_id=?'),
    deleteCfVideo: db.prepare('DELETE FROM cf_videos WHERE id=? AND user_id=?'),

    // Thread Chunks
    insertThreadChunk: db.prepare(`INSERT INTO thread_chunks (id,thread_id,user_id,chunk_index,content,summary,token_count,vector_id,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`),
    deleteThreadChunks: db.prepare('DELETE FROM thread_chunks WHERE thread_id=? AND user_id=?'),
    listUserThreads: db.prepare('SELECT thread_id, MIN(created_at) as created_at, COUNT(*) as chunk_count, SUM(token_count) as total_tokens FROM thread_chunks WHERE user_id=? GROUP BY thread_id ORDER BY MIN(created_at) DESC LIMIT ?'),

    // Users (no user_id filtering — these ARE the user table)
    insertUser: db.prepare(`INSERT INTO users (id,email,password_hash,display_name,plan,is_admin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`),
    getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    updateUser: db.prepare(`UPDATE users SET email=?,display_name=?,plan=?,updated_at=? WHERE id=?`),
    updateUserPassword: db.prepare(`UPDATE users SET password_hash=?,updated_at=? WHERE id=?`),
    countUsers: db.prepare('SELECT COUNT(*) as count FROM users'),

    // User Quotas
    getQuota: db.prepare('SELECT count FROM user_quotas WHERE user_id=? AND quota_type=? AND period=?'),
    incrementQuota: db.prepare(`INSERT INTO user_quotas (user_id, quota_type, period, count) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, quota_type, period) DO UPDATE SET count = count + 1`),
  };
}
