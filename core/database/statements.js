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

    // ========================================================================
    // CONSEQUENCE ENGINE
    // ========================================================================

    // Predictions (Layer 1 — Prediction Cortex)
    insertPrediction: db.prepare(`INSERT INTO predictions (id,conversation_id,message_id,prediction_text,prediction_type,domain,confidence,context_summary,source_model,extraction_method,status,expires_at,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    getPrediction: db.prepare('SELECT * FROM predictions WHERE id=? AND user_id=?'),
    listPredictions: db.prepare('SELECT * FROM predictions WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),
    listPendingPredictions: db.prepare('SELECT * FROM predictions WHERE user_id=? AND status=? ORDER BY created_at DESC LIMIT ?'),
    listPredictionsByDomain: db.prepare('SELECT * FROM predictions WHERE user_id=? AND domain=? ORDER BY created_at DESC LIMIT ?'),
    listPredictionsByConversation: db.prepare('SELECT * FROM predictions WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT ?'),
    listPredictionsByMessage: db.prepare('SELECT * FROM predictions WHERE user_id=? AND message_id=? ORDER BY created_at DESC'),
    listPredictionsByType: db.prepare('SELECT * FROM predictions WHERE user_id=? AND prediction_type=? ORDER BY created_at DESC LIMIT ?'),
    listPredictionsByStatus: db.prepare('SELECT * FROM predictions WHERE user_id=? AND status=? AND domain=? ORDER BY created_at DESC LIMIT ?'),
    resolvePrediction: db.prepare('UPDATE predictions SET status=?,outcome_id=?,resolved_at=?,verification_attempts=verification_attempts+1 WHERE id=? AND user_id=?'),
    expireOldPredictions: db.prepare('UPDATE predictions SET status=? WHERE user_id=? AND status=? AND created_at<?'),
    expireByTimestamp: db.prepare('UPDATE predictions SET status=? WHERE user_id=? AND status=? AND expires_at IS NOT NULL AND expires_at<?'),
    countPredictions: db.prepare('SELECT COUNT(*) as count FROM predictions WHERE user_id=?'),
    countPredictionsByStatus: db.prepare('SELECT status, COUNT(*) as count FROM predictions WHERE user_id=? GROUP BY status'),
    findDuplicatePrediction: db.prepare('SELECT * FROM predictions WHERE user_id=? AND message_id=? AND prediction_text=? LIMIT 1'),
    getRecentPendingByConversation: db.prepare('SELECT * FROM predictions WHERE user_id=? AND conversation_id=? AND status=? ORDER BY created_at DESC LIMIT 1'),

    // Outcomes (Layer 2 — Outcome Cortex)
    insertOutcomeResult: db.prepare(`INSERT INTO outcomes (id,prediction_id,trigger_type,trigger_source,trigger_data,result,confidence_delta,pain_delta,satisfaction_delta,lesson_learned,corrective_action,domain,severity,cascade_effects,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    getOutcomeResult: db.prepare('SELECT * FROM outcomes WHERE id=? AND user_id=?'),
    listOutcomeResults: db.prepare('SELECT * FROM outcomes WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),
    listOutcomesByDomain: db.prepare('SELECT * FROM outcomes WHERE user_id=? AND domain=? ORDER BY created_at DESC LIMIT ?'),
    listOutcomesByTrigger: db.prepare('SELECT * FROM outcomes WHERE user_id=? AND trigger_type=? ORDER BY created_at DESC LIMIT ?'),
    listOutcomesBySeverity: db.prepare('SELECT * FROM outcomes WHERE user_id=? AND severity=? ORDER BY created_at DESC LIMIT ?'),
    getOutcomeByPrediction: db.prepare('SELECT * FROM outcomes WHERE prediction_id=? AND user_id=?'),
    countOutcomes: db.prepare('SELECT COUNT(*) as count FROM outcomes WHERE user_id=?'),
    countOutcomesByResult: db.prepare('SELECT result, COUNT(*) as count FROM outcomes WHERE user_id=? GROUP BY result'),
    listRecentOutcomesByDomain: db.prepare('SELECT * FROM outcomes WHERE user_id=? AND domain=? AND created_at>? ORDER BY created_at DESC LIMIT ?'),

    // Domain States (Layer 3 — Emotional Weightmap)
    getDomainState: db.prepare('SELECT * FROM domain_states WHERE domain=? AND user_id=?'),
    listDomainStates: db.prepare('SELECT * FROM domain_states WHERE user_id=? ORDER BY updated_at DESC'),
    listDomainStatesByPain: db.prepare('SELECT * FROM domain_states WHERE user_id=? ORDER BY pain_score DESC'),
    listDomainStatesByAccuracy: db.prepare('SELECT * FROM domain_states WHERE user_id=? ORDER BY prediction_accuracy DESC'),
    upsertDomainState: db.prepare(`INSERT INTO domain_states (domain,user_id,pain_score,satisfaction_score,prediction_accuracy,calibration_offset,total_predictions,correct_predictions,wrong_predictions,partial_predictions,streak_type,streak_count,best_streak,worst_streak,last_pain_event,last_satisfaction_event,last_outcome_at,decay_rate,volatility,trend,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(domain,user_id) DO UPDATE SET
        pain_score=excluded.pain_score, satisfaction_score=excluded.satisfaction_score,
        prediction_accuracy=excluded.prediction_accuracy, calibration_offset=excluded.calibration_offset,
        total_predictions=excluded.total_predictions, correct_predictions=excluded.correct_predictions,
        wrong_predictions=excluded.wrong_predictions, partial_predictions=excluded.partial_predictions,
        streak_type=excluded.streak_type, streak_count=excluded.streak_count,
        best_streak=CASE WHEN excluded.best_streak>domain_states.best_streak THEN excluded.best_streak ELSE domain_states.best_streak END,
        worst_streak=CASE WHEN excluded.worst_streak>domain_states.worst_streak THEN excluded.worst_streak ELSE domain_states.worst_streak END,
        last_pain_event=CASE WHEN excluded.last_pain_event!='' THEN excluded.last_pain_event ELSE domain_states.last_pain_event END,
        last_satisfaction_event=CASE WHEN excluded.last_satisfaction_event!='' THEN excluded.last_satisfaction_event ELSE domain_states.last_satisfaction_event END,
        last_outcome_at=excluded.last_outcome_at,
        decay_rate=excluded.decay_rate, volatility=excluded.volatility, trend=excluded.trend,
        updated_at=excluded.updated_at`),
    deleteDomainState: db.prepare('DELETE FROM domain_states WHERE domain=? AND user_id=?'),

    // Domain History (Layer 3b — Temporal Tracking)
    insertDomainHistory: db.prepare(`INSERT INTO domain_history (id,domain,user_id,pain_score,satisfaction_score,prediction_accuracy,event_type,event_summary,snapshot_at) VALUES (?,?,?,?,?,?,?,?,?)`),
    listDomainHistory: db.prepare('SELECT * FROM domain_history WHERE domain=? AND user_id=? ORDER BY snapshot_at DESC LIMIT ?'),
    listDomainHistorySince: db.prepare('SELECT * FROM domain_history WHERE domain=? AND user_id=? AND snapshot_at>? ORDER BY snapshot_at ASC'),
    pruneDomainHistory: db.prepare('DELETE FROM domain_history WHERE user_id=? AND snapshot_at<?'),

    // Patterns (Layer 4 — Pattern Cortex)
    insertPattern: db.prepare(`INSERT INTO consequence_patterns (id,domain,pattern_type,pattern_signature,description,frequency,confidence,first_seen_at,last_seen_at,contributing_outcomes,suggested_gene,status,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    getPattern: db.prepare('SELECT * FROM consequence_patterns WHERE id=? AND user_id=?'),
    listPatterns: db.prepare('SELECT * FROM consequence_patterns WHERE user_id=? ORDER BY frequency DESC LIMIT ?'),
    listPatternsByDomain: db.prepare('SELECT * FROM consequence_patterns WHERE user_id=? AND domain=? ORDER BY frequency DESC LIMIT ?'),
    listPatternsByType: db.prepare('SELECT * FROM consequence_patterns WHERE user_id=? AND pattern_type=? ORDER BY frequency DESC LIMIT ?'),
    listEmergingPatterns: db.prepare('SELECT * FROM consequence_patterns WHERE user_id=? AND status=? ORDER BY frequency DESC LIMIT ?'),
    findPatternBySignature: db.prepare('SELECT * FROM consequence_patterns WHERE user_id=? AND domain=? AND pattern_signature=? LIMIT 1'),
    updatePatternFrequency: db.prepare('UPDATE consequence_patterns SET frequency=frequency+1, last_seen_at=?, contributing_outcomes=?, confidence=? WHERE id=? AND user_id=?'),
    updatePatternStatus: db.prepare('UPDATE consequence_patterns SET status=?, suggested_gene=? WHERE id=? AND user_id=?'),
    pruneWeakPatterns: db.prepare('DELETE FROM consequence_patterns WHERE user_id=? AND frequency<? AND status=?'),

    // Behavioral Genome (Layer 5)
    insertGene: db.prepare(`INSERT INTO behavioral_genome (id,gene_text,gene_type,domain,source_pattern,source_pattern_id,trigger_condition,action_directive,strength,status,confirmations,contradictions,applications,requires_review,regression_risk,parent_gene_id,mutation_history,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    getGene: db.prepare('SELECT * FROM behavioral_genome WHERE id=? AND user_id=?'),
    listActiveGenes: db.prepare('SELECT * FROM behavioral_genome WHERE user_id=? AND status=? AND strength>=? ORDER BY strength DESC LIMIT ?'),
    listGenesByDomain: db.prepare('SELECT * FROM behavioral_genome WHERE user_id=? AND domain=? AND status!=? ORDER BY strength DESC LIMIT ?'),
    listGenesByType: db.prepare('SELECT * FROM behavioral_genome WHERE user_id=? AND gene_type=? AND status!=? ORDER BY strength DESC LIMIT ?'),
    listPendingReviewGenes: db.prepare('SELECT * FROM behavioral_genome WHERE user_id=? AND status=? ORDER BY created_at DESC LIMIT ?'),
    listAllGenes: db.prepare('SELECT * FROM behavioral_genome WHERE user_id=? AND status!=? ORDER BY strength DESC LIMIT ?'),
    findGeneByText: db.prepare('SELECT * FROM behavioral_genome WHERE user_id=? AND domain=? AND gene_text=? LIMIT 1'),
    confirmGene: db.prepare('UPDATE behavioral_genome SET confirmations=confirmations+1, strength=MIN(1.0,strength+0.1), applications=applications+1, last_applied_at=?, updated_at=? WHERE id=? AND user_id=?'),
    contradictGene: db.prepare('UPDATE behavioral_genome SET contradictions=contradictions+1, strength=MAX(0.0,strength-0.15), status=CASE WHEN strength-0.15<0.2 THEN ? ELSE status END, updated_at=? WHERE id=? AND user_id=?'),
    applyGene: db.prepare('UPDATE behavioral_genome SET applications=applications+1, last_applied_at=?, updated_at=? WHERE id=? AND user_id=?'),
    deleteWeakGenes: db.prepare('DELETE FROM behavioral_genome WHERE user_id=? AND strength<? AND status=?'),
    updateGeneStatus: db.prepare('UPDATE behavioral_genome SET status=?,updated_at=? WHERE id=? AND user_id=?'),
    updateGeneStrength: db.prepare('UPDATE behavioral_genome SET strength=?,updated_at=? WHERE id=? AND user_id=?'),
    approveGene: db.prepare('UPDATE behavioral_genome SET status=?,requires_review=0,review_notes=?,updated_at=? WHERE id=? AND user_id=?'),
    mutateGene: db.prepare('UPDATE behavioral_genome SET gene_text=?,trigger_condition=?,action_directive=?,mutation_history=?,updated_at=? WHERE id=? AND user_id=?'),
    countGenes: db.prepare('SELECT COUNT(*) as count FROM behavioral_genome WHERE user_id=? AND status!=?'),
    countGenesByDomain: db.prepare('SELECT domain, COUNT(*) as count FROM behavioral_genome WHERE user_id=? AND status!=? GROUP BY domain'),
    countActiveGenesByDomain: db.prepare('SELECT domain, COUNT(*) as count FROM behavioral_genome WHERE user_id=? AND status=? GROUP BY domain'),

    // Gene Audit Log (Layer 5b)
    insertGeneAudit: db.prepare(`INSERT INTO gene_audit_log (id,gene_id,action,previous_state,new_state,reason,actor,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?)`),
    listGeneAudit: db.prepare('SELECT * FROM gene_audit_log WHERE gene_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?'),
    listRecentGeneAudits: db.prepare('SELECT * FROM gene_audit_log WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),

    // Calibration Snapshots (Layer 4b)
    insertCalibrationSnapshot: db.prepare(`INSERT INTO calibration_snapshots (id,domain,bucket_index,bucket_min,bucket_max,total_predictions,correct_predictions,actual_accuracy,overconfidence_delta,snapshot_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
    listCalibrationSnapshots: db.prepare('SELECT * FROM calibration_snapshots WHERE user_id=? AND domain=? ORDER BY snapshot_at DESC, bucket_index ASC LIMIT ?'),
    getLatestCalibration: db.prepare('SELECT * FROM calibration_snapshots WHERE user_id=? AND domain=? AND snapshot_at=(SELECT MAX(snapshot_at) FROM calibration_snapshots WHERE user_id=? AND domain=?) ORDER BY bucket_index ASC'),
    pruneOldCalibrations: db.prepare('DELETE FROM calibration_snapshots WHERE user_id=? AND snapshot_at<?'),

    // Consequence Engine: Aggregate Queries (Pattern Cortex)
    countPredictionsByDomain: db.prepare('SELECT domain, COUNT(*) as total, SUM(CASE WHEN status=? THEN 1 ELSE 0 END) as correct, SUM(CASE WHEN status=? THEN 1 ELSE 0 END) as wrong, SUM(CASE WHEN status=? THEN 1 ELSE 0 END) as partial FROM predictions WHERE user_id=? GROUP BY domain'),
    recentOutcomesWithPredictions: db.prepare(`SELECT o.*, p.prediction_text, p.confidence as pred_confidence, p.domain as pred_domain, p.prediction_type FROM outcomes o LEFT JOIN predictions p ON o.prediction_id=p.id WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT ?`),
    predictionAccuracyByConfidenceBucket: db.prepare(`SELECT
      CASE WHEN confidence < 0.2 THEN 0
           WHEN confidence < 0.4 THEN 1
           WHEN confidence < 0.6 THEN 2
           WHEN confidence < 0.8 THEN 3
           ELSE 4 END as bucket,
      COUNT(*) as total,
      SUM(CASE WHEN status='verified_correct' THEN 1 ELSE 0 END) as correct
      FROM predictions WHERE user_id=? AND status IN ('verified_correct','verified_wrong','verified_partial') GROUP BY bucket ORDER BY bucket`),
    domainAccuracyTrend: db.prepare(`SELECT domain,
      SUM(CASE WHEN status='verified_correct' AND created_at>? THEN 1 ELSE 0 END) as recent_correct,
      SUM(CASE WHEN status IN ('verified_correct','verified_wrong','verified_partial') AND created_at>? THEN 1 ELSE 0 END) as recent_total,
      SUM(CASE WHEN status='verified_correct' THEN 1 ELSE 0 END) as all_correct,
      SUM(CASE WHEN status IN ('verified_correct','verified_wrong','verified_partial') THEN 1 ELSE 0 END) as all_total
      FROM predictions WHERE user_id=? GROUP BY domain`),
    geneEffectiveness: db.prepare(`SELECT id, gene_text, domain, strength, confirmations, contradictions, applications,
      CASE WHEN (confirmations+contradictions)>0 THEN CAST(confirmations AS REAL)/(confirmations+contradictions) ELSE 0.5 END as effectiveness
      FROM behavioral_genome WHERE user_id=? AND status!=? ORDER BY effectiveness DESC LIMIT ?`),

    // ========================================================================
    // PROACTIVE INTELLIGENCE
    // ========================================================================

    // Product Metrics
    insertProductMetric: db.prepare('INSERT INTO product_metrics (id,metric_type,value,metadata,recorded_at,user_id) VALUES (?,?,?,?,?,?)'),
    listProductMetrics: db.prepare('SELECT * FROM product_metrics WHERE user_id=? AND metric_type=? AND recorded_at>? ORDER BY recorded_at DESC LIMIT ?'),
    latestProductMetric: db.prepare('SELECT * FROM product_metrics WHERE user_id=? AND metric_type=? ORDER BY recorded_at DESC LIMIT 1'),
    listLatestProductMetrics: db.prepare('SELECT pm.* FROM product_metrics pm INNER JOIN (SELECT metric_type, MAX(recorded_at) as max_ts FROM product_metrics WHERE user_id=? GROUP BY metric_type) latest ON pm.metric_type=latest.metric_type AND pm.recorded_at=latest.max_ts WHERE pm.user_id=?'),
    pruneOldMetrics: db.prepare('DELETE FROM product_metrics WHERE user_id=? AND recorded_at<?'),

    // Product Alerts
    insertProductAlert: db.prepare('INSERT INTO product_alerts (id,alert_type,severity,title,description,metric_type,metric_value,threshold_value,acknowledged,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,0,?,?)'),
    listProductAlerts: db.prepare('SELECT * FROM product_alerts WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),
    listUnacknowledgedAlerts: db.prepare('SELECT * FROM product_alerts WHERE user_id=? AND acknowledged=0 ORDER BY created_at DESC LIMIT ?'),
    acknowledgeAlert: db.prepare('UPDATE product_alerts SET acknowledged=1 WHERE id=? AND user_id=?'),
    acknowledgeAllAlerts: db.prepare('UPDATE product_alerts SET acknowledged=1 WHERE user_id=? AND acknowledged=0'),
    pruneOldAlerts: db.prepare('DELETE FROM product_alerts WHERE user_id=? AND created_at<? AND acknowledged=1'),

    // User Rhythm
    insertUserRhythm: db.prepare('INSERT INTO user_rhythm (id,rhythm_type,value,day_of_week,hour_of_day,recorded_at,user_id) VALUES (?,?,?,?,?,?,?)'),
    listUserRhythm: db.prepare('SELECT * FROM user_rhythm WHERE user_id=? AND rhythm_type=? ORDER BY recorded_at DESC LIMIT ?'),
    getUserRhythmHeatmap: db.prepare('SELECT hour_of_day, day_of_week, COUNT(*) as count FROM user_rhythm WHERE user_id=? AND rhythm_type=? AND recorded_at>? GROUP BY hour_of_day, day_of_week'),
    getUserRhythmPreferences: db.prepare('SELECT value, COUNT(*) as count FROM user_rhythm WHERE user_id=? AND rhythm_type=? AND recorded_at>? GROUP BY value ORDER BY count DESC LIMIT ?'),
    pruneOldRhythm: db.prepare('DELETE FROM user_rhythm WHERE user_id=? AND recorded_at<?'),

    // Self-Awareness
    insertSelfAwareness: db.prepare('INSERT INTO self_awareness_log (id,awareness_type,severity,summary,details,related_domain,recorded_at,user_id) VALUES (?,?,?,?,?,?,?,?)'),
    listSelfAwareness: db.prepare('SELECT * FROM self_awareness_log WHERE user_id=? ORDER BY recorded_at DESC LIMIT ?'),
    listSelfAwarenessByType: db.prepare('SELECT * FROM self_awareness_log WHERE user_id=? AND awareness_type=? ORDER BY recorded_at DESC LIMIT ?'),
    countSelfAwarenessBySeverity: db.prepare('SELECT severity, COUNT(*) as count FROM self_awareness_log WHERE user_id=? AND recorded_at>? GROUP BY severity'),
    recentSelfAwarenessBySeverity: db.prepare('SELECT * FROM self_awareness_log WHERE user_id=? AND severity=? AND recorded_at>? ORDER BY recorded_at DESC LIMIT ?'),
    pruneOldSelfAwareness: db.prepare('DELETE FROM self_awareness_log WHERE user_id=? AND recorded_at<?'),

    // Scheduler Jobs
    insertSchedulerJob: db.prepare('INSERT OR IGNORE INTO scheduler_jobs (id,name,description,interval_ms,handler,enabled,last_run_at,next_run_at,run_count,error_count,last_error,created_at,user_id) VALUES (?,?,?,?,?,1,0,0,0,0,\'\',?,?)'),
    listSchedulerJobs: db.prepare('SELECT * FROM scheduler_jobs WHERE user_id=? ORDER BY name'),
    getSchedulerJob: db.prepare('SELECT * FROM scheduler_jobs WHERE id=? AND user_id=?'),
    getSchedulerJobByName: db.prepare('SELECT * FROM scheduler_jobs WHERE name=? AND user_id=?'),
    updateJobAfterRun: db.prepare('UPDATE scheduler_jobs SET last_run_at=?, next_run_at=?, run_count=run_count+1, last_error=? WHERE id=? AND user_id=?'),
    updateJobError: db.prepare('UPDATE scheduler_jobs SET error_count=error_count+1, last_error=? WHERE id=? AND user_id=?'),
    toggleSchedulerJob: db.prepare('UPDATE scheduler_jobs SET enabled=? WHERE id=? AND user_id=?'),

    // Scheduler History
    insertSchedulerHistory: db.prepare('INSERT INTO scheduler_history (id,job_id,job_name,started_at,completed_at,duration_ms,status,result,error,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)'),
    updateSchedulerHistory: db.prepare('UPDATE scheduler_history SET completed_at=?, duration_ms=?, status=?, result=?, error=? WHERE id=? AND user_id=?'),
    listSchedulerHistory: db.prepare('SELECT * FROM scheduler_history WHERE user_id=? ORDER BY started_at DESC LIMIT ?'),
    listSchedulerHistoryByJob: db.prepare('SELECT * FROM scheduler_history WHERE user_id=? AND job_id=? ORDER BY started_at DESC LIMIT ?'),
  };
}
