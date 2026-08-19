/**
 * Generated from a replayed PostgreSQL schema (scripts/generate-supabase-database-types.ts).
 * Do not hand-edit. The previous checked-in copy declared character_equipment.description
 * (which does not exist) and omitted nine live columns — that lie produced #1859.
 *
 * DDL source of truth: db/schema/*.ts + db/migrations/.
 * Regenerate: replay migrations, then
 *   DATABASE_URL=postgres://localhost:5432/<db> bun scripts/generate-supabase-database-types.ts
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
    _drift_backup_20260725_characters: {
      Row: {
      id: string | null
      class_levels: Json | null
      }
      Insert: {
      id?: string | null
      class_levels?: Json | null
      }
      Update: {
      id?: string | null
      class_levels?: Json | null
      }
      Relationships: []
    }
    _drift_backup_20260725_tokens: {
      Row: {
      id: string | null
      created_by: string | null
      }
      Insert: {
      id?: string | null
      created_by?: string | null
      }
      Update: {
      id?: string | null
      created_by?: string | null
      }
      Relationships: []
    }
    agent_checkpoints: {
      Row: {
      id: string
      thread_id: string
      checkpoint_id: string
      parent_checkpoint_id: string | null
      state: Json
      metadata: Json | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      thread_id: string
      checkpoint_id: string
      parent_checkpoint_id?: string | null
      state: Json
      metadata?: Json | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      thread_id?: string
      checkpoint_id?: string
      parent_checkpoint_id?: string | null
      state?: Json
      metadata?: Json | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    ai_usage: {
      Row: {
      org_id: string | null
      user_id: string | null
      plan: string | null
      type: string | null
      units: number
      period_start: string
      created_at: string | null
      provider: string | null
      model: string | null
      input_tokens: number
      output_tokens: number
      total_tokens: number
      cost_usd: number
      }
      Insert: {
      org_id?: string | null
      user_id?: string | null
      plan?: string | null
      type?: string | null
      units: number
      period_start: string
      created_at?: string | null
      provider?: string | null
      model?: string | null
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
      cost_usd?: number
      }
      Update: {
      org_id?: string | null
      user_id?: string | null
      plan?: string | null
      type?: string | null
      units?: number
      period_start?: string
      created_at?: string | null
      provider?: string | null
      model?: string | null
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
      cost_usd?: number
      }
      Relationships: []
    }
    blog_api_keys: {
      Row: {
      id: string
      name: string
      key_hash: string
      permissions: Json
      expires_at: string | null
      disabled: boolean
      created_at: string
      updated_at: string
      last_used_at: string | null
      }
      Insert: {
      id?: string
      name: string
      key_hash: string
      permissions?: Json
      expires_at?: string | null
      disabled?: boolean
      created_at?: string
      updated_at?: string
      last_used_at?: string | null
      }
      Update: {
      id?: string
      name?: string
      key_hash?: string
      permissions?: Json
      expires_at?: string | null
      disabled?: boolean
      created_at?: string
      updated_at?: string
      last_used_at?: string | null
      }
      Relationships: []
    }
    blog_authors: {
      Row: {
      id: string
      user_id: string | null
      display_name: string
      slug: string
      short_bio: string | null
      bio: string | null
      avatar_url: string | null
      website_url: string | null
      twitter_handle: string | null
      linkedin_url: string | null
      metadata: Json
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      user_id?: string | null
      display_name: string
      slug: string
      short_bio?: string | null
      bio?: string | null
      avatar_url?: string | null
      website_url?: string | null
      twitter_handle?: string | null
      linkedin_url?: string | null
      metadata?: Json
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      user_id?: string | null
      display_name?: string
      slug?: string
      short_bio?: string | null
      bio?: string | null
      avatar_url?: string | null
      website_url?: string | null
      twitter_handle?: string | null
      linkedin_url?: string | null
      metadata?: Json
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    blog_baseline_screenshots: {
      Row: {
      id: string
      page_key: string
      page_url: string
      screenshot_path: string
      captured_at: string | null
      commit_hash: string | null
      metadata: Json | null
      }
      Insert: {
      id?: string
      page_key: string
      page_url: string
      screenshot_path: string
      captured_at?: string | null
      commit_hash?: string | null
      metadata?: Json | null
      }
      Update: {
      id?: string
      page_key?: string
      page_url?: string
      screenshot_path?: string
      captured_at?: string | null
      commit_hash?: string | null
      metadata?: Json | null
      }
      Relationships: []
    }
    blog_categories: {
      Row: {
      id: string
      name: string
      slug: string
      description: string | null
      seo_title: string | null
      seo_description: string | null
      metadata: Json
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      name: string
      slug: string
      description?: string | null
      seo_title?: string | null
      seo_description?: string | null
      metadata?: Json
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      name?: string
      slug?: string
      description?: string | null
      seo_title?: string | null
      seo_description?: string | null
      metadata?: Json
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    blog_digest_queue: {
      Row: {
      id: string
      commit_hash: string
      commit_message: string
      author: string | null
      files_changed: Json | null
      pr_number: number | null
      pr_title: string | null
      committed_at: string
      processed: boolean | null
      digest_post_id: string | null
      created_at: string | null
      }
      Insert: {
      id?: string
      commit_hash: string
      commit_message: string
      author?: string | null
      files_changed?: Json | null
      pr_number?: number | null
      pr_title?: string | null
      committed_at: string
      processed?: boolean | null
      digest_post_id?: string | null
      created_at?: string | null
      }
      Update: {
      id?: string
      commit_hash?: string
      commit_message?: string
      author?: string | null
      files_changed?: Json | null
      pr_number?: number | null
      pr_title?: string | null
      committed_at?: string
      processed?: boolean | null
      digest_post_id?: string | null
      created_at?: string | null
      }
      Relationships: []
    }
    blog_digests: {
      Row: {
      id: string
      post_id: string | null
      digest_date: string
      commit_count: number
      commits_included: Json | null
      hero_image_prompt: string | null
      hero_image_path: string | null
      screenshots_included: Json | null
      major_feature_detected: boolean | null
      standalone_post_id: string | null
      ai_analysis: Json | null
      created_at: string | null
      }
      Insert: {
      id?: string
      post_id?: string | null
      digest_date: string
      commit_count?: number
      commits_included?: Json | null
      hero_image_prompt?: string | null
      hero_image_path?: string | null
      screenshots_included?: Json | null
      major_feature_detected?: boolean | null
      standalone_post_id?: string | null
      ai_analysis?: Json | null
      created_at?: string | null
      }
      Update: {
      id?: string
      post_id?: string | null
      digest_date?: string
      commit_count?: number
      commits_included?: Json | null
      hero_image_prompt?: string | null
      hero_image_path?: string | null
      screenshots_included?: Json | null
      major_feature_detected?: boolean | null
      standalone_post_id?: string | null
      ai_analysis?: Json | null
      created_at?: string | null
      }
      Relationships: []
    }
    blog_post_categories: {
      Row: {
      post_id: string
      category_id: string
      assigned_at: string | null
      }
      Insert: {
      post_id: string
      category_id: string
      assigned_at?: string | null
      }
      Update: {
      post_id?: string
      category_id?: string
      assigned_at?: string | null
      }
      Relationships: []
    }
    blog_post_tags: {
      Row: {
      post_id: string
      tag_id: string
      assigned_at: string | null
      }
      Insert: {
      post_id: string
      tag_id: string
      assigned_at?: string | null
      }
      Update: {
      post_id?: string
      tag_id?: string
      assigned_at?: string | null
      }
      Relationships: []
    }
    blog_posts: {
      Row: {
      id: string
      author_id: string
      title: string
      slug: string
      summary: string | null
      content: string | null
      featured_image_url: string | null
      hero_image_alt: string | null
      seo_title: string | null
      seo_description: string | null
      seo_keywords: Json
      canonical_url: string | null
      status: string
      scheduled_for: string | null
      published_at: string | null
      metadata: Json
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      author_id: string
      title: string
      slug: string
      summary?: string | null
      content?: string | null
      featured_image_url?: string | null
      hero_image_alt?: string | null
      seo_title?: string | null
      seo_description?: string | null
      seo_keywords?: Json
      canonical_url?: string | null
      status?: string
      scheduled_for?: string | null
      published_at?: string | null
      metadata?: Json
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      author_id?: string
      title?: string
      slug?: string
      summary?: string | null
      content?: string | null
      featured_image_url?: string | null
      hero_image_alt?: string | null
      seo_title?: string | null
      seo_description?: string | null
      seo_keywords?: Json
      canonical_url?: string | null
      status?: string
      scheduled_for?: string | null
      published_at?: string | null
      metadata?: Json
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    blog_tags: {
      Row: {
      id: string
      name: string
      slug: string
      description: string | null
      metadata: Json
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      name: string
      slug: string
      description?: string | null
      metadata?: Json
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      name?: string
      slug?: string
      description?: string | null
      metadata?: Json
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    campaign_characters: {
      Row: {
      id: string
      campaign_id: string
      character_id: string
      role: string | null
      joined_at: string | null
      is_active: boolean | null
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      campaign_id: string
      character_id: string
      role?: string | null
      joined_at?: string | null
      is_active?: boolean | null
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      campaign_id?: string
      character_id?: string
      role?: string | null
      joined_at?: string | null
      is_active?: boolean | null
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    campaign_chunks: {
      Row: {
      id: string
      campaign_id: string
      chunk_type: string
      entity_name: string | null
      parent_entity: string | null
      content: string
      summary: string | null
      metadata: Json | null
      source_file: string | null
      source_section: string | null
      sequence_order: number | null
      version: number
      created_at: string
      }
      Insert: {
      id?: string
      campaign_id: string
      chunk_type: string
      entity_name?: string | null
      parent_entity?: string | null
      content: string
      summary?: string | null
      metadata?: Json | null
      source_file?: string | null
      source_section?: string | null
      sequence_order?: number | null
      version?: number
      created_at?: string
      }
      Update: {
      id?: string
      campaign_id?: string
      chunk_type?: string
      entity_name?: string | null
      parent_entity?: string | null
      content?: string
      summary?: string | null
      metadata?: Json | null
      source_file?: string | null
      source_section?: string | null
      sequence_order?: number | null
      version?: number
      created_at?: string
      }
      Relationships: []
    }
    campaign_journal_entries: {
      Row: {
      id: string
      campaign_id: string
      session_id: string
      entry_type: string
      handout_mode: string | null
      handout_key: string | null
      title: string
      body: string | null
      giver: string | null
      asset_path: string | null
      created_at: string
      }
      Insert: {
      id?: string
      campaign_id: string
      session_id: string
      entry_type: string
      handout_mode?: string | null
      handout_key?: string | null
      title: string
      body?: string | null
      giver?: string | null
      asset_path?: string | null
      created_at?: string
      }
      Update: {
      id?: string
      campaign_id?: string
      session_id?: string
      entry_type?: string
      handout_mode?: string | null
      handout_key?: string | null
      title?: string
      body?: string | null
      giver?: string | null
      asset_path?: string | null
      created_at?: string
      }
      Relationships: []
    }
    campaign_parties: {
      Row: {
      id: string
      campaign_id: string
      party_name: string
      party_concept: string
      party_hook: string
      playstyle: string
      is_default: boolean
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      campaign_id: string
      party_name: string
      party_concept: string
      party_hook: string
      playstyle: string
      is_default?: boolean
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      campaign_id?: string
      party_name?: string
      party_concept?: string
      party_hook?: string
      playstyle?: string
      is_default?: boolean
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    campaign_rules: {
      Row: {
      id: string
      campaign_id: string
      rule_type: string
      condition: string
      effect: string
      reversible: boolean
      priority: number
      metadata: Json | null
      created_at: string
      }
      Insert: {
      id?: string
      campaign_id: string
      rule_type: string
      condition: string
      effect: string
      reversible?: boolean
      priority?: number
      metadata?: Json | null
      created_at?: string
      }
      Update: {
      id?: string
      campaign_id?: string
      rule_type?: string
      condition?: string
      effect?: string
      reversible?: boolean
      priority?: number
      metadata?: Json | null
      created_at?: string
      }
      Relationships: []
    }
    campaigns: {
      Row: {
      id: string
      user_id: string
      name: string
      description: string | null
      genre: string | null
      difficulty_level: string | null
      campaign_length: string | null
      tone: string | null
      era: string | null
      location: string | null
      atmosphere: string | null
      setting_details: Json | null
      thematic_elements: Json | null
      status: string
      background_image: string | null
      art_style: string | null
      style_config: Json | null
      rules_config: Json | null
      created_at: string
      updated_at: string
      template: boolean
      visibility: string
      template_version: number
      thumbnail_url: string | null
      published_at: string | null
      }
      Insert: {
      id?: string
      user_id: string
      name: string
      description?: string | null
      genre?: string | null
      difficulty_level?: string | null
      campaign_length?: string | null
      tone?: string | null
      era?: string | null
      location?: string | null
      atmosphere?: string | null
      setting_details?: Json | null
      thematic_elements?: Json | null
      status?: string
      background_image?: string | null
      art_style?: string | null
      style_config?: Json | null
      rules_config?: Json | null
      created_at?: string
      updated_at?: string
      template?: boolean
      visibility?: string
      template_version?: number
      thumbnail_url?: string | null
      published_at?: string | null
      }
      Update: {
      id?: string
      user_id?: string
      name?: string
      description?: string | null
      genre?: string | null
      difficulty_level?: string | null
      campaign_length?: string | null
      tone?: string | null
      era?: string | null
      location?: string | null
      atmosphere?: string | null
      setting_details?: Json | null
      thematic_elements?: Json | null
      status?: string
      background_image?: string | null
      art_style?: string | null
      style_config?: Json | null
      rules_config?: Json | null
      created_at?: string
      updated_at?: string
      template?: boolean
      visibility?: string
      template_version?: number
      thumbnail_url?: string | null
      published_at?: string | null
      }
      Relationships: []
    }
    character_conditions: {
      Row: {
      id: string
      character_id: string
      condition_id: string
      duration_type: string | null
      duration_value: number | null
      applied_at: string | null
      expires_at: string | null
      source_description: string | null
      is_active: boolean | null
      created_at: string | null
      }
      Insert: {
      id?: string
      character_id: string
      condition_id: string
      duration_type?: string | null
      duration_value?: number | null
      applied_at?: string | null
      expires_at?: string | null
      source_description?: string | null
      is_active?: boolean | null
      created_at?: string | null
      }
      Update: {
      id?: string
      character_id?: string
      condition_id?: string
      duration_type?: string | null
      duration_value?: number | null
      applied_at?: string | null
      expires_at?: string | null
      source_description?: string | null
      is_active?: boolean | null
      created_at?: string | null
      }
      Relationships: []
    }
    character_creation_metrics: {
      Row: {
      id: string
      character_id: string | null
      user_id: string | null
      creation_method: string | null
      time_to_create_seconds: number | null
      steps_completed: number | null
      ai_suggestions_used: number | null
      manual_edits: number | null
      template_used: string | null
      completed: boolean | null
      abandoned_at_step: string | null
      created_at: string | null
      }
      Insert: {
      id?: string
      character_id?: string | null
      user_id?: string | null
      creation_method?: string | null
      time_to_create_seconds?: number | null
      steps_completed?: number | null
      ai_suggestions_used?: number | null
      manual_edits?: number | null
      template_used?: string | null
      completed?: boolean | null
      abandoned_at_step?: string | null
      created_at?: string | null
      }
      Update: {
      id?: string
      character_id?: string | null
      user_id?: string | null
      creation_method?: string | null
      time_to_create_seconds?: number | null
      steps_completed?: number | null
      ai_suggestions_used?: number | null
      manual_edits?: number | null
      template_used?: string | null
      completed?: boolean | null
      abandoned_at_step?: string | null
      created_at?: string | null
      }
      Relationships: []
    }
    character_equipment: {
      Row: {
      id: string
      character_id: string
      item_name: string
      item_type: string | null
      quantity: number | null
      equipped: boolean | null
      is_magic: boolean | null
      magic_bonus: number | null
      magic_properties: string | null
      requires_attunement: boolean | null
      is_attuned: boolean | null
      attunement_requirements: string | null
      magic_item_type: string | null
      magic_item_rarity: string | null
      magic_effects: Json | null
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      character_id: string
      item_name: string
      item_type?: string | null
      quantity?: number | null
      equipped?: boolean | null
      is_magic?: boolean | null
      magic_bonus?: number | null
      magic_properties?: string | null
      requires_attunement?: boolean | null
      is_attuned?: boolean | null
      attunement_requirements?: string | null
      magic_item_type?: string | null
      magic_item_rarity?: string | null
      magic_effects?: Json | null
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      character_id?: string
      item_name?: string
      item_type?: string | null
      quantity?: number | null
      equipped?: boolean | null
      is_magic?: boolean | null
      magic_bonus?: number | null
      magic_properties?: string | null
      requires_attunement?: boolean | null
      is_attuned?: boolean | null
      attunement_requirements?: string | null
      magic_item_type?: string | null
      magic_item_rarity?: string | null
      magic_effects?: Json | null
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    character_features: {
      Row: {
      id: string
      character_id: string
      feature_id: string
      uses_remaining: number | null
      is_active: boolean
      acquired_at_level: number
      created_at: string
      }
      Insert: {
      id?: string
      character_id: string
      feature_id: string
      uses_remaining?: number | null
      is_active?: boolean
      acquired_at_level: number
      created_at?: string
      }
      Update: {
      id?: string
      character_id?: string
      feature_id?: string
      uses_remaining?: number | null
      is_active?: boolean
      acquired_at_level?: number
      created_at?: string
      }
      Relationships: []
    }
    character_folders: {
      Row: {
      id: string
      user_id: string
      name: string
      parent_folder_id: string | null
      color: string | null
      icon: string | null
      sort_order: number
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      user_id: string
      name: string
      parent_folder_id?: string | null
      color?: string | null
      icon?: string | null
      sort_order?: number
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      user_id?: string
      name?: string
      parent_folder_id?: string | null
      color?: string | null
      icon?: string | null
      sort_order?: number
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    character_hit_dice: {
      Row: {
      id: string
      character_id: string
      class_name: string
      die_type: string
      total_dice: number
      used_dice: number
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      character_id: string
      class_name: string
      die_type: string
      total_dice: number
      used_dice?: number
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      character_id?: string
      class_name?: string
      die_type?: string
      total_dice?: number
      used_dice?: number
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    character_passive_skills: {
      Row: {
      character_id: string | null
      character_name: string | null
      level: number | null
      wisdom: number | null
      intelligence: number | null
      passive_perception: number | null
      passive_insight: number | null
      passive_investigation: number | null
      skill_proficiencies: string | null
      }
      Insert: {
      character_id?: string | null
      character_name?: string | null
      level?: number | null
      wisdom?: number | null
      intelligence?: number | null
      passive_perception?: number | null
      passive_insight?: number | null
      passive_investigation?: number | null
      skill_proficiencies?: string | null
      }
      Update: {
      character_id?: string | null
      character_name?: string | null
      level?: number | null
      wisdom?: number | null
      intelligence?: number | null
      passive_perception?: number | null
      passive_insight?: number | null
      passive_investigation?: number | null
      skill_proficiencies?: string | null
      }
      Relationships: []
    }
    character_permissions: {
      Row: {
      id: string
      character_id: string
      user_id: string
      permission_level: string
      can_control_token: boolean
      can_edit_sheet: boolean
      granted_at: string
      granted_by: string
      }
      Insert: {
      id?: string
      character_id: string
      user_id: string
      permission_level?: string
      can_control_token?: boolean
      can_edit_sheet?: boolean
      granted_at?: string
      granted_by: string
      }
      Update: {
      id?: string
      character_id?: string
      user_id?: string
      permission_level?: string
      can_control_token?: boolean
      can_edit_sheet?: boolean
      granted_at?: string
      granted_by?: string
      }
      Relationships: []
    }
    character_spell_slots: {
      Row: {
      id: string
      character_id: string
      spell_level: number
      total_slots: number
      used_slots: number
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      character_id: string
      spell_level: number
      total_slots?: number
      used_slots?: number
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      character_id?: string
      spell_level?: number
      total_slots?: number
      used_slots?: number
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    character_spells: {
      Row: {
      id: string
      character_id: string
      spell_id: string
      source_class_id: string
      is_prepared: boolean | null
      is_always_prepared: boolean | null
      source_feature: string | null
      spell_level_learned: number | null
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      character_id: string
      spell_id: string
      source_class_id: string
      is_prepared?: boolean | null
      is_always_prepared?: boolean | null
      source_feature?: string | null
      spell_level_learned?: number | null
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      character_id?: string
      spell_id?: string
      source_class_id?: string
      is_prepared?: boolean | null
      is_always_prepared?: boolean | null
      source_feature?: string | null
      spell_level_learned?: number | null
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    character_stats: {
      Row: {
      id: string
      character_id: string
      strength: number
      dexterity: number
      constitution: number
      intelligence: number
      wisdom: number
      charisma: number
      created_at: string | null
      updated_at: string | null
      armor_class: number
      temporary_hit_points: number | null
      initiative_bonus: number | null
      speed: number | null
      max_hit_points: number
      current_hit_points: number
      is_conscious: boolean
      death_saves_successes: number
      death_saves_failures: number
      vital_state: string
      died_at: string | null
      }
      Insert: {
      id?: string
      character_id: string
      strength?: number
      dexterity?: number
      constitution?: number
      intelligence?: number
      wisdom?: number
      charisma?: number
      created_at?: string | null
      updated_at?: string | null
      armor_class?: number
      temporary_hit_points?: number | null
      initiative_bonus?: number | null
      speed?: number | null
      max_hit_points?: number
      current_hit_points?: number
      is_conscious?: boolean
      death_saves_successes?: number
      death_saves_failures?: number
      vital_state?: string
      died_at?: string | null
      }
      Update: {
      id?: string
      character_id?: string
      strength?: number
      dexterity?: number
      constitution?: number
      intelligence?: number
      wisdom?: number
      charisma?: number
      created_at?: string | null
      updated_at?: string | null
      armor_class?: number
      temporary_hit_points?: number | null
      initiative_bonus?: number | null
      speed?: number | null
      max_hit_points?: number
      current_hit_points?: number
      is_conscious?: boolean
      death_saves_successes?: number
      death_saves_failures?: number
      vital_state?: string
      died_at?: string | null
      }
      Relationships: []
    }
    character_subclasses: {
      Row: {
      id: string
      character_id: string
      class_name: string
      subclass_name: string
      chosen_at_level: number
      created_at: string
      }
      Insert: {
      id?: string
      character_id: string
      class_name: string
      subclass_name: string
      chosen_at_level: number
      created_at?: string
      }
      Update: {
      id?: string
      character_id?: string
      class_name?: string
      subclass_name?: string
      chosen_at_level?: number
      created_at?: string
      }
      Relationships: []
    }
    character_tokens: {
      Row: {
      character_id: string
      token_id: string
      }
      Insert: {
      character_id: string
      token_id: string
      }
      Update: {
      character_id?: string
      token_id?: string
      }
      Relationships: []
    }
    character_voice_profiles: {
      Row: {
      id: string
      character_id: string
      voice_style: string
      speech_patterns: Json | null
      vocabulary_level: string | null
      tone: string | null
      quirks: Json | null
      example_phrases: Json | null
      consistency_score: number | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      character_id: string
      voice_style: string
      speech_patterns?: Json | null
      vocabulary_level?: string | null
      tone?: string | null
      quirks?: Json | null
      example_phrases?: Json | null
      consistency_score?: number | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      character_id?: string
      voice_style?: string
      speech_patterns?: Json | null
      vocabulary_level?: string | null
      tone?: string | null
      quirks?: Json | null
      example_phrases?: Json | null
      consistency_score?: number | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    characters: {
      Row: {
      id: string
      user_id: string
      campaign_id: string | null
      name: string
      description: string | null
      race: string | null
      class: string | null
      level: number
      alignment: string | null
      experience_points: number | null
      background: string | null
      image_url: string | null
      avatar_url: string | null
      background_image: string | null
      appearance: string | null
      personality_traits: string | null
      personality_notes: string | null
      backstory_elements: string | null
      cantrips: string | null
      known_spells: string | null
      prepared_spells: string | null
      ritual_spells: string | null
      vision_types: Json | null
      obscurement: string | null
      is_hidden: boolean | null
      created_at: string | null
      updated_at: string | null
      subrace: string | null
      skill_proficiencies: string | null
      tool_proficiencies: string | null
      saving_throw_proficiencies: string | null
      languages: Json | null
      theme: string | null
      class_levels: Json | null
      total_level: number | null
      owner_id: string | null
      is_public: boolean
      sharing_mode: string
      folder_id: string | null
      session_notes: string | null
      spell_slots: Json | null
      active_concentration: string | null
      class_features: Json | null
      fighting_styles: Json | null
      copper_pieces: number | null
      silver_pieces: number | null
      electrum_pieces: number | null
      gold_pieces: number | null
      platinum_pieces: number | null
      damage_resistances: Json | null
      damage_immunities: Json | null
      damage_vulnerabilities: Json | null
      stealth_check_bonus: number | null
      expertise_proficiencies: string | null
      pact_slots: Json | null
      }
      Insert: {
      id?: string
      user_id: string
      campaign_id?: string | null
      name: string
      description?: string | null
      race?: string | null
      class?: string | null
      level?: number
      alignment?: string | null
      experience_points?: number | null
      background?: string | null
      image_url?: string | null
      avatar_url?: string | null
      background_image?: string | null
      appearance?: string | null
      personality_traits?: string | null
      personality_notes?: string | null
      backstory_elements?: string | null
      cantrips?: string | null
      known_spells?: string | null
      prepared_spells?: string | null
      ritual_spells?: string | null
      vision_types?: Json | null
      obscurement?: string | null
      is_hidden?: boolean | null
      created_at?: string | null
      updated_at?: string | null
      subrace?: string | null
      skill_proficiencies?: string | null
      tool_proficiencies?: string | null
      saving_throw_proficiencies?: string | null
      languages?: Json | null
      theme?: string | null
      class_levels?: Json | null
      total_level?: number | null
      owner_id?: string | null
      is_public?: boolean
      sharing_mode?: string
      folder_id?: string | null
      session_notes?: string | null
      spell_slots?: Json | null
      active_concentration?: string | null
      class_features?: Json | null
      fighting_styles?: Json | null
      copper_pieces?: number | null
      silver_pieces?: number | null
      electrum_pieces?: number | null
      gold_pieces?: number | null
      platinum_pieces?: number | null
      damage_resistances?: Json | null
      damage_immunities?: Json | null
      damage_vulnerabilities?: Json | null
      stealth_check_bonus?: number | null
      expertise_proficiencies?: string | null
      pact_slots?: Json | null
      }
      Update: {
      id?: string
      user_id?: string
      campaign_id?: string | null
      name?: string
      description?: string | null
      race?: string | null
      class?: string | null
      level?: number
      alignment?: string | null
      experience_points?: number | null
      background?: string | null
      image_url?: string | null
      avatar_url?: string | null
      background_image?: string | null
      appearance?: string | null
      personality_traits?: string | null
      personality_notes?: string | null
      backstory_elements?: string | null
      cantrips?: string | null
      known_spells?: string | null
      prepared_spells?: string | null
      ritual_spells?: string | null
      vision_types?: Json | null
      obscurement?: string | null
      is_hidden?: boolean | null
      created_at?: string | null
      updated_at?: string | null
      subrace?: string | null
      skill_proficiencies?: string | null
      tool_proficiencies?: string | null
      saving_throw_proficiencies?: string | null
      languages?: Json | null
      theme?: string | null
      class_levels?: Json | null
      total_level?: number | null
      owner_id?: string | null
      is_public?: boolean
      sharing_mode?: string
      folder_id?: string | null
      session_notes?: string | null
      spell_slots?: Json | null
      active_concentration?: string | null
      class_features?: Json | null
      fighting_styles?: Json | null
      copper_pieces?: number | null
      silver_pieces?: number | null
      electrum_pieces?: number | null
      gold_pieces?: number | null
      platinum_pieces?: number | null
      damage_resistances?: Json | null
      damage_immunities?: Json | null
      damage_vulnerabilities?: Json | null
      stealth_check_bonus?: number | null
      expertise_proficiencies?: string | null
      pact_slots?: Json | null
      }
      Relationships: []
    }
    class_features_library: {
      Row: {
      id: string
      class_name: string
      subclass_name: string | null
      feature_name: string
      level_acquired: number
      description: string
      mechanical_effects: string | null
      usage_type: string | null
      uses_per_rest: string | null
      uses_count: number | null
      created_at: string
      }
      Insert: {
      id?: string
      class_name: string
      subclass_name?: string | null
      feature_name: string
      level_acquired: number
      description: string
      mechanical_effects?: string | null
      usage_type?: string | null
      uses_per_rest?: string | null
      uses_count?: number | null
      created_at?: string
      }
      Update: {
      id?: string
      class_name?: string
      subclass_name?: string | null
      feature_name?: string
      level_acquired?: number
      description?: string
      mechanical_effects?: string | null
      usage_type?: string | null
      uses_per_rest?: string | null
      uses_count?: number | null
      created_at?: string
      }
      Relationships: []
    }
    class_spells: {
      Row: {
      id: string
      class_id: string
      spell_id: string
      spell_level: number
      source_feature: string | null
      created_at: string | null
      }
      Insert: {
      id?: string
      class_id: string
      spell_id: string
      spell_level: number
      source_feature?: string | null
      created_at?: string | null
      }
      Update: {
      id?: string
      class_id?: string
      spell_id?: string
      spell_level?: number
      source_feature?: string | null
      created_at?: string | null
      }
      Relationships: []
    }
    classes: {
      Row: {
      id: string
      name: string
      hit_die: number
      spellcasting_ability: string | null
      caster_type: string | null
      spell_slots_start_level: number | null
      ritual_casting: boolean | null
      spellcasting_focus_type: string | null
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      name: string
      hit_die: number
      spellcasting_ability?: string | null
      caster_type?: string | null
      spell_slots_start_level?: number | null
      ritual_casting?: boolean | null
      spellcasting_focus_type?: string | null
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      name?: string
      hit_die?: number
      spellcasting_ability?: string | null
      caster_type?: string | null
      spell_slots_start_level?: number | null
      ritual_casting?: boolean | null
      spellcasting_focus_type?: string | null
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    combat_damage_log: {
      Row: {
      id: string
      encounter_id: string
      participant_id: string
      damage_amount: number
      damage_type: string
      source_participant_id: string | null
      source_description: string | null
      round_number: number
      created_at: string
      }
      Insert: {
      id?: string
      encounter_id: string
      participant_id: string
      damage_amount: number
      damage_type: string
      source_participant_id?: string | null
      source_description?: string | null
      round_number: number
      created_at?: string
      }
      Update: {
      id?: string
      encounter_id?: string
      participant_id?: string
      damage_amount?: number
      damage_type?: string
      source_participant_id?: string | null
      source_description?: string | null
      round_number?: number
      created_at?: string
      }
      Relationships: []
    }
    combat_encounters: {
      Row: {
      id: string
      session_id: string
      status: string
      current_round: number
      current_turn_order: number
      location: string | null
      difficulty: string | null
      experience_awarded: number | null
      started_at: string
      ended_at: string | null
      created_at: string
      updated_at: string
      version: number
      ended_reason: string | null
      }
      Insert: {
      id?: string
      session_id: string
      status?: string
      current_round?: number
      current_turn_order?: number
      location?: string | null
      difficulty?: string | null
      experience_awarded?: number | null
      started_at?: string
      ended_at?: string | null
      created_at?: string
      updated_at?: string
      version?: number
      ended_reason?: string | null
      }
      Update: {
      id?: string
      session_id?: string
      status?: string
      current_round?: number
      current_turn_order?: number
      location?: string | null
      difficulty?: string | null
      experience_awarded?: number | null
      started_at?: string
      ended_at?: string | null
      created_at?: string
      updated_at?: string
      version?: number
      ended_reason?: string | null
      }
      Relationships: []
    }
    combat_participant_conditions: {
      Row: {
      id: string
      participant_id: string
      condition_id: string
      duration_type: string
      duration_value: number | null
      save_dc: number | null
      save_ability: string | null
      applied_at_round: number
      expires_at_round: number | null
      source_description: string | null
      is_active: boolean
      created_at: string
      }
      Insert: {
      id?: string
      participant_id: string
      condition_id: string
      duration_type: string
      duration_value?: number | null
      save_dc?: number | null
      save_ability?: string | null
      applied_at_round: number
      expires_at_round?: number | null
      source_description?: string | null
      is_active?: boolean
      created_at?: string
      }
      Update: {
      id?: string
      participant_id?: string
      condition_id?: string
      duration_type?: string
      duration_value?: number | null
      save_dc?: number | null
      save_ability?: string | null
      applied_at_round?: number
      expires_at_round?: number | null
      source_description?: string | null
      is_active?: boolean
      created_at?: string
      }
      Relationships: []
    }
    combat_participant_status: {
      Row: {
      id: string
      participant_id: string
      current_hp: number
      max_hp: number
      temp_hp: number
      is_conscious: boolean
      death_saves_successes: number
      death_saves_failures: number
      updated_at: string
      exhaustion_level: number
      }
      Insert: {
      id?: string
      participant_id: string
      current_hp: number
      max_hp: number
      temp_hp?: number
      is_conscious?: boolean
      death_saves_successes?: number
      death_saves_failures?: number
      updated_at?: string
      exhaustion_level?: number
      }
      Update: {
      id?: string
      participant_id?: string
      current_hp?: number
      max_hp?: number
      temp_hp?: number
      is_conscious?: boolean
      death_saves_successes?: number
      death_saves_failures?: number
      updated_at?: string
      exhaustion_level?: number
      }
      Relationships: []
    }
    combat_participants: {
      Row: {
      id: string
      encounter_id: string
      character_id: string | null
      npc_id: string | null
      name: string
      participant_type: string
      initiative: number
      initiative_modifier: number
      turn_order: number
      is_active: boolean
      armor_class: number
      max_hp: number
      speed: number
      damage_resistances: Json | null
      damage_immunities: Json | null
      damage_vulnerabilities: Json | null
      multiclass_info: Json | null
      created_at: string
      updated_at: string
      resources_round: number
      action_used: boolean
      bonus_action_used: boolean
      reaction_used: boolean
      is_dodging: boolean
      is_disengaged: boolean
      monster_attack: Json | null
      }
      Insert: {
      id?: string
      encounter_id: string
      character_id?: string | null
      npc_id?: string | null
      name: string
      participant_type: string
      initiative?: number
      initiative_modifier?: number
      turn_order: number
      is_active?: boolean
      armor_class?: number
      max_hp?: number
      speed?: number
      damage_resistances?: Json | null
      damage_immunities?: Json | null
      damage_vulnerabilities?: Json | null
      multiclass_info?: Json | null
      created_at?: string
      updated_at?: string
      resources_round?: number
      action_used?: boolean
      bonus_action_used?: boolean
      reaction_used?: boolean
      is_dodging?: boolean
      is_disengaged?: boolean
      monster_attack?: Json | null
      }
      Update: {
      id?: string
      encounter_id?: string
      character_id?: string | null
      npc_id?: string | null
      name?: string
      participant_type?: string
      initiative?: number
      initiative_modifier?: number
      turn_order?: number
      is_active?: boolean
      armor_class?: number
      max_hp?: number
      speed?: number
      damage_resistances?: Json | null
      damage_immunities?: Json | null
      damage_vulnerabilities?: Json | null
      multiclass_info?: Json | null
      created_at?: string
      updated_at?: string
      resources_round?: number
      action_used?: boolean
      bonus_action_used?: boolean
      reaction_used?: boolean
      is_dodging?: boolean
      is_disengaged?: boolean
      monster_attack?: Json | null
      }
      Relationships: []
    }
    conditions_library: {
      Row: {
      id: string
      name: string
      description: string
      mechanical_effects: string
      icon_name: string | null
      created_at: string
      }
      Insert: {
      id?: string
      name: string
      description: string
      mechanical_effects: string
      icon_name?: string | null
      created_at?: string
      }
      Update: {
      id?: string
      name?: string
      description?: string
      mechanical_effects?: string
      icon_name?: string | null
      created_at?: string
      }
      Relationships: []
    }
    consumable_usage_log: {
      Row: {
      id: string
      character_id: string
      item_id: string
      quantity_used: number
      session_id: string | null
      context: string | null
      timestamp: string
      }
      Insert: {
      id?: string
      character_id: string
      item_id: string
      quantity_used?: number
      session_id?: string | null
      context?: string | null
      timestamp?: string
      }
      Update: {
      id?: string
      character_id?: string
      item_id?: string
      quantity_used?: number
      session_id?: string | null
      context?: string | null
      timestamp?: string
      }
      Relationships: []
    }
    creature_stats: {
      Row: {
      id: string
      character_id: string | null
      npc_id: string | null
      armor_class: number
      resistances: Json | null
      vulnerabilities: Json | null
      immunities: Json | null
      condition_immunities: Json | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      character_id?: string | null
      npc_id?: string | null
      armor_class?: number
      resistances?: Json | null
      vulnerabilities?: Json | null
      immunities?: Json | null
      condition_immunities?: Json | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      character_id?: string | null
      npc_id?: string | null
      armor_class?: number
      resistances?: Json | null
      vulnerabilities?: Json | null
      immunities?: Json | null
      condition_immunities?: Json | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    dialogue_history: {
      Row: {
      id: string
      session_id: string | null
      speaker_type: string | null
      speaker_id: string | null
      message: string
      timestamp: string | null
      context: Json | null
      created_at: string | null
      updated_at: string | null
      sequence_number: number
      images: Json | null
      }
      Insert: {
      id?: string
      session_id?: string | null
      speaker_type?: string | null
      speaker_id?: string | null
      message: string
      timestamp?: string | null
      context?: Json | null
      created_at?: string | null
      updated_at?: string | null
      sequence_number: number
      images?: Json | null
      }
      Update: {
      id?: string
      session_id?: string | null
      speaker_type?: string | null
      speaker_id?: string | null
      message?: string
      timestamp?: string | null
      context?: Json | null
      created_at?: string | null
      updated_at?: string | null
      sequence_number?: number
      images?: Json | null
      }
      Relationships: []
    }
    experience_events: {
      Row: {
      id: string
      character_id: string
      session_id: string | null
      xp_gained: number
      source: string
      description: string | null
      timestamp: string
      }
      Insert: {
      id?: string
      character_id: string
      session_id?: string | null
      xp_gained: number
      source: string
      description?: string | null
      timestamp?: string
      }
      Update: {
      id?: string
      character_id?: string
      session_id?: string | null
      xp_gained?: number
      source?: string
      description?: string | null
      timestamp?: string
      }
      Relationships: []
    }
    feature_usage_log: {
      Row: {
      id: string
      character_id: string
      feature_id: string
      session_id: string | null
      used_at: string
      context: string | null
      created_at: string
      }
      Insert: {
      id?: string
      character_id: string
      feature_id: string
      session_id?: string | null
      used_at?: string
      context?: string | null
      created_at?: string
      }
      Update: {
      id?: string
      character_id?: string
      feature_id?: string
      session_id?: string | null
      used_at?: string
      context?: string | null
      created_at?: string
      }
      Relationships: []
    }
    fog_of_war: {
      Row: {
      id: string
      scene_id: string
      user_id: string
      revealed_areas: Json
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      scene_id: string
      user_id: string
      revealed_areas?: Json
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      scene_id?: string
      user_id?: string
      revealed_areas?: Json
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    game_sessions: {
      Row: {
      id: string
      campaign_id: string | null
      character_id: string | null
      session_number: number | null
      start_time: string | null
      end_time: string | null
      status: string | null
      current_scene_description: string | null
      summary: string | null
      session_notes: string | null
      turn_count: number | null
      created_at: string | null
      updated_at: string | null
      session_state: Json | null
      starter_campaign_id: string | null
      campaign_version: number | null
      ruleset: string | null
      }
      Insert: {
      id?: string
      campaign_id?: string | null
      character_id?: string | null
      session_number?: number | null
      start_time?: string | null
      end_time?: string | null
      status?: string | null
      current_scene_description?: string | null
      summary?: string | null
      session_notes?: string | null
      turn_count?: number | null
      created_at?: string | null
      updated_at?: string | null
      session_state?: Json | null
      starter_campaign_id?: string | null
      campaign_version?: number | null
      ruleset?: string | null
      }
      Update: {
      id?: string
      campaign_id?: string | null
      character_id?: string | null
      session_number?: number | null
      start_time?: string | null
      end_time?: string | null
      status?: string | null
      current_scene_description?: string | null
      summary?: string | null
      session_notes?: string | null
      turn_count?: number | null
      created_at?: string | null
      updated_at?: string | null
      session_state?: Json | null
      starter_campaign_id?: string | null
      campaign_version?: number | null
      ruleset?: string | null
      }
      Relationships: []
    }
    inventory_items: {
      Row: {
      id: string
      character_id: string
      name: string
      item_type: string
      quantity: number
      weight: number | null
      description: string | null
      properties: string | null
      is_equipped: boolean
      is_attuned: boolean
      requires_attunement: boolean
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      character_id: string
      name: string
      item_type: string
      quantity?: number
      weight?: number | null
      description?: string | null
      properties?: string | null
      is_equipped?: boolean
      is_attuned?: boolean
      requires_attunement?: boolean
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      character_id?: string
      name?: string
      item_type?: string
      quantity?: number
      weight?: number | null
      description?: string | null
      properties?: string | null
      is_equipped?: boolean
      is_attuned?: boolean
      requires_attunement?: boolean
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    level_progression: {
      Row: {
      character_id: string
      current_level: number
      current_xp: number
      xp_to_next_level: number
      total_xp: number
      last_level_up: string | null
      updated_at: string
      }
      Insert: {
      character_id: string
      current_level?: number
      current_xp?: number
      xp_to_next_level: number
      total_xp?: number
      last_level_up?: string | null
      updated_at?: string
      }
      Update: {
      character_id?: string
      current_level?: number
      current_xp?: number
      xp_to_next_level?: number
      total_xp?: number
      last_level_up?: string | null
      updated_at?: string
      }
      Relationships: []
    }
    locations: {
      Row: {
      id: string
      campaign_id: string
      name: string
      location_type: string | null
      description: string | null
      population: number | null
      climate: string | null
      terrain: string | null
      notable_features: Json | null
      connected_locations: Json | null
      image_url: string | null
      map_url: string | null
      metadata: Json | null
      created_at: string | null
      updated_at: string | null
      generated_by: string | null
      }
      Insert: {
      id?: string
      campaign_id: string
      name: string
      location_type?: string | null
      description?: string | null
      population?: number | null
      climate?: string | null
      terrain?: string | null
      notable_features?: Json | null
      connected_locations?: Json | null
      image_url?: string | null
      map_url?: string | null
      metadata?: Json | null
      created_at?: string | null
      updated_at?: string | null
      generated_by?: string | null
      }
      Update: {
      id?: string
      campaign_id?: string
      name?: string
      location_type?: string | null
      description?: string | null
      population?: number | null
      climate?: string | null
      terrain?: string | null
      notable_features?: Json | null
      connected_locations?: Json | null
      image_url?: string | null
      map_url?: string | null
      metadata?: Json | null
      created_at?: string | null
      updated_at?: string | null
      generated_by?: string | null
      }
      Relationships: []
    }
    measurement_templates: {
      Row: {
      id: string
      scene_id: string
      created_by: string
      template_type: string
      origin_x: number
      origin_y: number
      direction: number
      distance: number
      width: number | null
      color: string
      opacity: number
      is_temporary: boolean
      created_at: string
      }
      Insert: {
      id?: string
      scene_id: string
      created_by: string
      template_type: string
      origin_x: number
      origin_y: number
      direction: number
      distance: number
      width?: number | null
      color?: string
      opacity?: number
      is_temporary?: boolean
      created_at?: string
      }
      Update: {
      id?: string
      scene_id?: string
      created_by?: string
      template_type?: string
      origin_x?: number
      origin_y?: number
      direction?: number
      distance?: number
      width?: number | null
      color?: string
      opacity?: number
      is_temporary?: boolean
      created_at?: string
      }
      Relationships: []
    }
    memories: {
      Row: {
      id: string
      campaign_id: string | null
      session_id: string | null
      memory_type: string | null
      importance: number | null
      content: string
      context: Json | null
      embedding: string | null
      created_at: string | null
      updated_at: string | null
      emotional_tone: string | null
      type: string | null
      subcategory: string | null
      metadata: Json | null
      narrative_weight: number | null
      story_arc: string | null
      prose_quality: boolean | null
      chapter_marker: boolean | null
      }
      Insert: {
      id?: string
      campaign_id?: string | null
      session_id?: string | null
      memory_type?: string | null
      importance?: number | null
      content: string
      context?: Json | null
      embedding?: string | null
      created_at?: string | null
      updated_at?: string | null
      emotional_tone?: string | null
      type?: string | null
      subcategory?: string | null
      metadata?: Json | null
      narrative_weight?: number | null
      story_arc?: string | null
      prose_quality?: boolean | null
      chapter_marker?: boolean | null
      }
      Update: {
      id?: string
      campaign_id?: string | null
      session_id?: string | null
      memory_type?: string | null
      importance?: number | null
      content?: string
      context?: Json | null
      embedding?: string | null
      created_at?: string | null
      updated_at?: string | null
      emotional_tone?: string | null
      type?: string | null
      subcategory?: string | null
      metadata?: Json | null
      narrative_weight?: number | null
      story_arc?: string | null
      prose_quality?: boolean | null
      chapter_marker?: boolean | null
      }
      Relationships: []
    }
    narrative_facts: {
      Row: {
      id: string
      session_id: string
      campaign_id: string | null
      subject_type: string
      subject_name: string
      predicate: string
      value: Json
      known_by: Json
      is_belief: boolean
      source: string
      turn_index: number | null
      message_id: string | null
      needs_review: boolean
      valid_from: string
      invalidated_at: string | null
      invalidated_by: string | null
      created_at: string
      }
      Insert: {
      id?: string
      session_id: string
      campaign_id?: string | null
      subject_type: string
      subject_name: string
      predicate: string
      value: Json
      known_by?: Json
      is_belief?: boolean
      source: string
      turn_index?: number | null
      message_id?: string | null
      needs_review?: boolean
      valid_from?: string
      invalidated_at?: string | null
      invalidated_by?: string | null
      created_at?: string
      }
      Update: {
      id?: string
      session_id?: string
      campaign_id?: string | null
      subject_type?: string
      subject_name?: string
      predicate?: string
      value?: Json
      known_by?: Json
      is_belief?: boolean
      source?: string
      turn_index?: number | null
      message_id?: string | null
      needs_review?: boolean
      valid_from?: string
      invalidated_at?: string | null
      invalidated_by?: string | null
      created_at?: string
      }
      Relationships: []
    }
    npcs: {
      Row: {
      id: string
      campaign_id: string
      name: string
      race: string | null
      occupation: string | null
      personality: string | null
      description: string | null
      backstory: string | null
      relationship: string | null
      location: string | null
      image_url: string | null
      voice_id: string | null
      stats: Json | null
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      campaign_id: string
      name: string
      race?: string | null
      occupation?: string | null
      personality?: string | null
      description?: string | null
      backstory?: string | null
      relationship?: string | null
      location?: string | null
      image_url?: string | null
      voice_id?: string | null
      stats?: Json | null
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      campaign_id?: string
      name?: string
      race?: string | null
      occupation?: string | null
      personality?: string | null
      description?: string | null
      backstory?: string | null
      relationship?: string | null
      location?: string | null
      image_url?: string | null
      voice_id?: string | null
      stats?: Json | null
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    party_characters: {
      Row: {
      id: string
      party_id: string
      character_name: string
      race: string
      class: string
      level: number
      backstory: string
      personality: string
      campaign_hook: string
      party_relationship: string | null
      stats: Json
      portrait_prompt: string | null
      portrait_url: string | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      party_id: string
      character_name: string
      race: string
      class: string
      level?: number
      backstory: string
      personality: string
      campaign_hook: string
      party_relationship?: string | null
      stats: Json
      portrait_prompt?: string | null
      portrait_url?: string | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      party_id?: string
      character_name?: string
      race?: string
      class?: string
      level?: number
      backstory?: string
      personality?: string
      campaign_hook?: string
      party_relationship?: string | null
      stats?: Json
      portrait_prompt?: string | null
      portrait_url?: string | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    processed_stripe_events: {
      Row: {
      event_id: string
      event_type: string
      processed_at: string
      }
      Insert: {
      event_id: string
      event_type: string
      processed_at?: string
      }
      Update: {
      event_id?: string
      event_type?: string
      processed_at?: string
      }
      Relationships: []
    }
    quests: {
      Row: {
      id: string
      campaign_id: string
      title: string
      description: string | null
      quest_giver: string | null
      objectives: Json | null
      rewards: Json | null
      status: string | null
      difficulty: string | null
      quest_type: string | null
      location_id: string | null
      metadata: Json | null
      created_at: string | null
      updated_at: string | null
      session_id: string | null
      }
      Insert: {
      id?: string
      campaign_id: string
      title: string
      description?: string | null
      quest_giver?: string | null
      objectives?: Json | null
      rewards?: Json | null
      status?: string | null
      difficulty?: string | null
      quest_type?: string | null
      location_id?: string | null
      metadata?: Json | null
      created_at?: string | null
      updated_at?: string | null
      session_id?: string | null
      }
      Update: {
      id?: string
      campaign_id?: string
      title?: string
      description?: string | null
      quest_giver?: string | null
      objectives?: Json | null
      rewards?: Json | null
      status?: string | null
      difficulty?: string | null
      quest_type?: string | null
      location_id?: string | null
      metadata?: Json | null
      created_at?: string | null
      updated_at?: string | null
      session_id?: string | null
      }
      Relationships: []
    }
    races: {
      Row: {
      id: string
      name: string
      description: string | null
      ability_score_increases: Json | null
      traits: Json | null
      speed: number | null
      size: string | null
      languages: Json | null
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      name: string
      description?: string | null
      ability_score_increases?: Json | null
      traits?: Json | null
      speed?: number | null
      size?: string | null
      languages?: Json | null
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      name?: string
      description?: string | null
      ability_score_increases?: Json | null
      traits?: Json | null
      speed?: number | null
      size?: string | null
      languages?: Json | null
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    rest_events: {
      Row: {
      id: string
      character_id: string
      session_id: string | null
      rest_type: string
      started_at: string
      completed_at: string | null
      hp_restored: number | null
      hit_dice_spent: number | null
      resources_restored: string | null
      interrupted: boolean
      notes: string | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      character_id: string
      session_id?: string | null
      rest_type: string
      started_at?: string
      completed_at?: string | null
      hp_restored?: number | null
      hit_dice_spent?: number | null
      resources_restored?: string | null
      interrupted?: boolean
      notes?: string | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      character_id?: string
      session_id?: string | null
      rest_type?: string
      started_at?: string
      completed_at?: string | null
      hp_restored?: number | null
      hit_dice_spent?: number | null
      resources_restored?: string | null
      interrupted?: boolean
      notes?: string | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    scene_drawings: {
      Row: {
      id: string
      scene_id: string
      created_by: string
      drawing_type: string
      points_data: Json
      stroke_color: string
      stroke_width: number
      fill_color: string | null
      fill_opacity: number
      z_index: number
      text_content: string | null
      font_size: number | null
      font_family: string | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      scene_id: string
      created_by: string
      drawing_type: string
      points_data: Json
      stroke_color: string
      stroke_width: number
      fill_color?: string | null
      fill_opacity?: number
      z_index?: number
      text_content?: string | null
      font_size?: number | null
      font_family?: string | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      scene_id?: string
      created_by?: string
      drawing_type?: string
      points_data?: Json
      stroke_color?: string
      stroke_width?: number
      fill_color?: string | null
      fill_opacity?: number
      z_index?: number
      text_content?: string | null
      font_size?: number | null
      font_family?: string | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    scene_layers: {
      Row: {
      id: string
      scene_id: string
      layer_type: string
      z_index: number
      is_visible: boolean
      opacity: number
      locked: boolean
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      scene_id: string
      layer_type: string
      z_index: number
      is_visible?: boolean
      opacity?: number
      locked?: boolean
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      scene_id?: string
      layer_type?: string
      z_index?: number
      is_visible?: boolean
      opacity?: number
      locked?: boolean
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    scene_settings: {
      Row: {
      id: string
      scene_id: string
      enable_fog_of_war: boolean
      enable_dynamic_lighting: boolean
      snap_to_grid: boolean
      grid_opacity: number
      ambient_light_level: number
      darkness_level: number
      weather_effects: string | null
      time_of_day: string | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      scene_id: string
      enable_fog_of_war?: boolean
      enable_dynamic_lighting?: boolean
      snap_to_grid?: boolean
      grid_opacity?: number
      ambient_light_level?: number
      darkness_level?: number
      weather_effects?: string | null
      time_of_day?: string | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      scene_id?: string
      enable_fog_of_war?: boolean
      enable_dynamic_lighting?: boolean
      snap_to_grid?: boolean
      grid_opacity?: number
      ambient_light_level?: number
      darkness_level?: number
      weather_effects?: string | null
      time_of_day?: string | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    scenes: {
      Row: {
      id: string
      name: string
      description: string | null
      campaign_id: string
      user_id: string
      width: number
      height: number
      grid_size: number
      grid_type: string
      grid_color: string | null
      background_image_url: string | null
      thumbnail_url: string | null
      is_active: boolean
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      name: string
      description?: string | null
      campaign_id: string
      user_id: string
      width: number
      height: number
      grid_size?: number
      grid_type?: string
      grid_color?: string | null
      background_image_url?: string | null
      thumbnail_url?: string | null
      is_active?: boolean
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      name?: string
      description?: string | null
      campaign_id?: string
      user_id?: string
      width?: number
      height?: number
      grid_size?: number
      grid_type?: string
      grid_color?: string | null
      background_image_url?: string | null
      thumbnail_url?: string | null
      is_active?: boolean
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    schema_migrations: {
      Row: {
      filename: string
      applied_at: string
      status: string
      note: string | null
      }
      Insert: {
      filename: string
      applied_at?: string
      status?: string
      note?: string | null
      }
      Update: {
      filename?: string
      applied_at?: string
      status?: string
      note?: string | null
      }
      Relationships: []
    }
    session_chronicles: {
      Row: {
      id: string
      session_id: string
      user_id: string
      status: string
      chronicle_text: string | null
      chapter_title: string | null
      previously_on: string | null
      illustration_url: string | null
      share_token: string | null
      generated_at: string | null
      error_message: string | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      session_id: string
      user_id: string
      status?: string
      chronicle_text?: string | null
      chapter_title?: string | null
      previously_on?: string | null
      illustration_url?: string | null
      share_token?: string | null
      generated_at?: string | null
      error_message?: string | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      session_id?: string
      user_id?: string
      status?: string
      chronicle_text?: string | null
      chapter_title?: string | null
      previously_on?: string | null
      illustration_url?: string | null
      share_token?: string | null
      generated_at?: string | null
      error_message?: string | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    spell_slot_usage_log: {
      Row: {
      id: string
      character_id: string
      session_id: string | null
      spell_name: string
      spell_level: number
      slot_level_used: number
      timestamp: string
      }
      Insert: {
      id?: string
      character_id: string
      session_id?: string | null
      spell_name: string
      spell_level: number
      slot_level_used: number
      timestamp?: string
      }
      Update: {
      id?: string
      character_id?: string
      session_id?: string | null
      spell_name?: string
      spell_level?: number
      slot_level_used?: number
      timestamp?: string
      }
      Relationships: []
    }
    spells: {
      Row: {
      id: string
      name: string
      level: number
      school: string
      casting_time: string
      range_text: string
      duration: string
      concentration: boolean | null
      ritual: boolean | null
      components_verbal: boolean | null
      components_somatic: boolean | null
      components_material: boolean | null
      material_components: string | null
      material_cost_gp: number | null
      material_consumed: boolean | null
      description: string
      higher_level_text: string | null
      attack_type: string | null
      damage_type: string | null
      damage_at_slot_level: Json | null
      heal_at_slot_level: Json | null
      area_of_effect: Json | null
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      name: string
      level: number
      school: string
      casting_time: string
      range_text: string
      duration: string
      concentration?: boolean | null
      ritual?: boolean | null
      components_verbal?: boolean | null
      components_somatic?: boolean | null
      components_material?: boolean | null
      material_components?: string | null
      material_cost_gp?: number | null
      material_consumed?: boolean | null
      description: string
      higher_level_text?: string | null
      attack_type?: string | null
      damage_type?: string | null
      damage_at_slot_level?: Json | null
      heal_at_slot_level?: Json | null
      area_of_effect?: Json | null
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      name?: string
      level?: number
      school?: string
      casting_time?: string
      range_text?: string
      duration?: string
      concentration?: boolean | null
      ritual?: boolean | null
      components_verbal?: boolean | null
      components_somatic?: boolean | null
      components_material?: boolean | null
      material_components?: string | null
      material_cost_gp?: number | null
      material_consumed?: boolean | null
      description?: string
      higher_level_text?: string | null
      attack_type?: string | null
      damage_type?: string | null
      damage_at_slot_level?: Json | null
      heal_at_slot_level?: Json | null
      area_of_effect?: Json | null
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    starter_campaigns: {
      Row: {
      id: string
      slug: string
      title: string
      tagline: string | null
      genre: Json
      sub_genre: Json | null
      tone: Json
      difficulty: string
      level_range: string | null
      estimated_sessions: string | null
      premise: string
      creative_brief: string | null
      overview: string | null
      is_complete: boolean
      is_published: boolean
      is_featured: boolean
      release_date: string | null
      release_event: string | null
      current_version: number
      cover_image_url: string | null
      banner_image_url: string | null
      gallery_images: Json | null
      play_count: number | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id: string
      slug: string
      title: string
      tagline?: string | null
      genre: Json
      sub_genre?: Json | null
      tone: Json
      difficulty: string
      level_range?: string | null
      estimated_sessions?: string | null
      premise: string
      creative_brief?: string | null
      overview?: string | null
      is_complete?: boolean
      is_published?: boolean
      is_featured?: boolean
      release_date?: string | null
      release_event?: string | null
      current_version?: number
      cover_image_url?: string | null
      banner_image_url?: string | null
      gallery_images?: Json | null
      play_count?: number | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      slug?: string
      title?: string
      tagline?: string | null
      genre?: Json
      sub_genre?: Json | null
      tone?: Json
      difficulty?: string
      level_range?: string | null
      estimated_sessions?: string | null
      premise?: string
      creative_brief?: string | null
      overview?: string | null
      is_complete?: boolean
      is_published?: boolean
      is_featured?: boolean
      release_date?: string | null
      release_event?: string | null
      current_version?: number
      cover_image_url?: string | null
      banner_image_url?: string | null
      gallery_images?: Json | null
      play_count?: number | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    starter_character_templates: {
      Row: {
      id: string
      starter_campaign_id: string
      template_key: string
      name: string
      tagline: string | null
      race: string
      subrace: string | null
      class: string
      background: string | null
      level: number | null
      ability_scores: Json
      personality: Json | null
      skills: Json | null
      languages: Json | null
      equipment: Json | null
      adapted_backstory: string | null
      campaign_hook: string | null
      portrait_url: string | null
      portrait_prompt: string | null
      display_order: number | null
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      starter_campaign_id: string
      template_key: string
      name: string
      tagline?: string | null
      race: string
      subrace?: string | null
      class: string
      background?: string | null
      level?: number | null
      ability_scores?: Json
      personality?: Json | null
      skills?: Json | null
      languages?: Json | null
      equipment?: Json | null
      adapted_backstory?: string | null
      campaign_hook?: string | null
      portrait_url?: string | null
      portrait_prompt?: string | null
      display_order?: number | null
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      starter_campaign_id?: string
      template_key?: string
      name?: string
      tagline?: string | null
      race?: string
      subrace?: string | null
      class?: string
      background?: string | null
      level?: number | null
      ability_scores?: Json
      personality?: Json | null
      skills?: Json | null
      languages?: Json | null
      equipment?: Json | null
      adapted_backstory?: string | null
      campaign_hook?: string | null
      portrait_url?: string | null
      portrait_prompt?: string | null
      display_order?: number | null
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    tactical_maps: {
      Row: {
      id: string
      session_id: string
      state: Json
      active: boolean
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      session_id: string
      state: Json
      active?: boolean
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      session_id?: string
      state?: Json
      active?: boolean
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    token_configurations: {
      Row: {
      id: string
      character_id: string | null
      monster_id: string | null
      size_width: number | null
      size_height: number | null
      grid_size: string | null
      image_url: string | null
      avatar_url: string | null
      tint_color: string | null
      scale: number | null
      opacity: number | null
      border_color: string | null
      border_width: number | null
      show_nameplate: boolean | null
      nameplate_position: string | null
      vision_enabled: boolean | null
      vision_range: number | null
      vision_angle: number | null
      night_vision: boolean | null
      darkvision_range: number | null
      emits_light: boolean | null
      light_range: number | null
      light_angle: number | null
      light_color: string | null
      light_intensity: number | null
      dim_light_range: number | null
      bright_light_range: number | null
      movement_speed: number | null
      has_flying: boolean | null
      has_swimming: boolean | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      character_id?: string | null
      monster_id?: string | null
      size_width?: number | null
      size_height?: number | null
      grid_size?: string | null
      image_url?: string | null
      avatar_url?: string | null
      tint_color?: string | null
      scale?: number | null
      opacity?: number | null
      border_color?: string | null
      border_width?: number | null
      show_nameplate?: boolean | null
      nameplate_position?: string | null
      vision_enabled?: boolean | null
      vision_range?: number | null
      vision_angle?: number | null
      night_vision?: boolean | null
      darkvision_range?: number | null
      emits_light?: boolean | null
      light_range?: number | null
      light_angle?: number | null
      light_color?: string | null
      light_intensity?: number | null
      dim_light_range?: number | null
      bright_light_range?: number | null
      movement_speed?: number | null
      has_flying?: boolean | null
      has_swimming?: boolean | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      character_id?: string | null
      monster_id?: string | null
      size_width?: number | null
      size_height?: number | null
      grid_size?: string | null
      image_url?: string | null
      avatar_url?: string | null
      tint_color?: string | null
      scale?: number | null
      opacity?: number | null
      border_color?: string | null
      border_width?: number | null
      show_nameplate?: boolean | null
      nameplate_position?: string | null
      vision_enabled?: boolean | null
      vision_range?: number | null
      vision_angle?: number | null
      night_vision?: boolean | null
      darkvision_range?: number | null
      emits_light?: boolean | null
      light_range?: number | null
      light_angle?: number | null
      light_color?: string | null
      light_intensity?: number | null
      dim_light_range?: number | null
      bright_light_range?: number | null
      movement_speed?: number | null
      has_flying?: boolean | null
      has_swimming?: boolean | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    tokens: {
      Row: {
      id: string
      scene_id: string
      actor_id: string | null
      created_by: string
      name: string
      token_type: string
      position_x: number
      position_y: number
      rotation: number | null
      elevation: number | null
      size_width: number
      size_height: number
      grid_size: string
      image_url: string | null
      avatar_url: string | null
      tint_color: string | null
      scale: number | null
      opacity: number | null
      border_color: string | null
      border_width: number | null
      show_nameplate: boolean | null
      nameplate_position: string | null
      vision_enabled: boolean | null
      vision_range: number | null
      vision_angle: number | null
      night_vision: boolean | null
      darkvision_range: number | null
      emits_light: boolean | null
      light_range: number | null
      light_angle: number | null
      light_color: string | null
      light_intensity: number | null
      dim_light_range: number | null
      bright_light_range: number | null
      is_locked: boolean | null
      is_hidden: boolean | null
      is_visible: boolean | null
      movement_speed: number | null
      has_flying: boolean | null
      has_swimming: boolean | null
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      scene_id: string
      actor_id?: string | null
      created_by: string
      name: string
      token_type: string
      position_x: number
      position_y: number
      rotation?: number | null
      elevation?: number | null
      size_width: number
      size_height: number
      grid_size: string
      image_url?: string | null
      avatar_url?: string | null
      tint_color?: string | null
      scale?: number | null
      opacity?: number | null
      border_color?: string | null
      border_width?: number | null
      show_nameplate?: boolean | null
      nameplate_position?: string | null
      vision_enabled?: boolean | null
      vision_range?: number | null
      vision_angle?: number | null
      night_vision?: boolean | null
      darkvision_range?: number | null
      emits_light?: boolean | null
      light_range?: number | null
      light_angle?: number | null
      light_color?: string | null
      light_intensity?: number | null
      dim_light_range?: number | null
      bright_light_range?: number | null
      is_locked?: boolean | null
      is_hidden?: boolean | null
      is_visible?: boolean | null
      movement_speed?: number | null
      has_flying?: boolean | null
      has_swimming?: boolean | null
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      scene_id?: string
      actor_id?: string | null
      created_by?: string
      name?: string
      token_type?: string
      position_x?: number
      position_y?: number
      rotation?: number | null
      elevation?: number | null
      size_width?: number
      size_height?: number
      grid_size?: string
      image_url?: string | null
      avatar_url?: string | null
      tint_color?: string | null
      scale?: number | null
      opacity?: number | null
      border_color?: string | null
      border_width?: number | null
      show_nameplate?: boolean | null
      nameplate_position?: string | null
      vision_enabled?: boolean | null
      vision_range?: number | null
      vision_angle?: number | null
      night_vision?: boolean | null
      darkvision_range?: number | null
      emits_light?: boolean | null
      light_range?: number | null
      light_angle?: number | null
      light_color?: string | null
      light_intensity?: number | null
      dim_light_range?: number | null
      bright_light_range?: number | null
      is_locked?: boolean | null
      is_hidden?: boolean | null
      is_visible?: boolean | null
      movement_speed?: number | null
      has_flying?: boolean | null
      has_swimming?: boolean | null
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    users: {
      Row: {
      id: string
      email: string
      first_name: string | null
      last_name: string | null
      plan: string
      created_at: string
      updated_at: string
      stripe_customer_id: string | null
      stripe_subscription_id: string | null
      subscription_status: string | null
      ab_variant: string | null
      }
      Insert: {
      id: string
      email: string
      first_name?: string | null
      last_name?: string | null
      plan?: string
      created_at?: string
      updated_at?: string
      stripe_customer_id?: string | null
      stripe_subscription_id?: string | null
      subscription_status?: string | null
      ab_variant?: string | null
      }
      Update: {
      id?: string
      email?: string
      first_name?: string | null
      last_name?: string | null
      plan?: string
      created_at?: string
      updated_at?: string
      stripe_customer_id?: string | null
      stripe_subscription_id?: string | null
      subscription_status?: string | null
      ab_variant?: string | null
      }
      Relationships: []
    }
    vision_blocking_shapes: {
      Row: {
      id: string
      scene_id: string
      shape_type: string
      points_data: Json
      blocks_movement: boolean
      blocks_vision: boolean
      blocks_light: boolean
      is_one_way: boolean
      door_state: string | null
      created_by: string
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      scene_id: string
      shape_type: string
      points_data: Json
      blocks_movement?: boolean
      blocks_vision?: boolean
      blocks_light?: boolean
      is_one_way?: boolean
      door_state?: string | null
      created_by: string
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      scene_id?: string
      shape_type?: string
      points_data?: Json
      blocks_movement?: boolean
      blocks_vision?: boolean
      blocks_light?: boolean
      is_one_way?: boolean
      door_state?: string | null
      created_by?: string
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    waitlist: {
      Row: {
      id: string
      email: string
      name: string | null
      source: string
      status: string
      created_at: string
      updated_at: string
      }
      Insert: {
      id?: string
      email: string
      name?: string | null
      source?: string
      status?: string
      created_at?: string
      updated_at?: string
      }
      Update: {
      id?: string
      email?: string
      name?: string | null
      source?: string
      status?: string
      created_at?: string
      updated_at?: string
      }
      Relationships: []
    }
    weapon_attacks: {
      Row: {
      id: string
      character_id: string
      name: string
      attack_bonus: number
      damage_dice: string
      damage_bonus: number
      damage_type: string
      properties: Json | null
      description: string | null
      created_at: string
      }
      Insert: {
      id?: string
      character_id: string
      name: string
      attack_bonus: number
      damage_dice: string
      damage_bonus?: number
      damage_type: string
      properties?: Json | null
      description?: string | null
      created_at?: string
      }
      Update: {
      id?: string
      character_id?: string
      name?: string
      attack_bonus?: number
      damage_dice?: string
      damage_bonus?: number
      damage_type?: string
      properties?: Json | null
      description?: string | null
      created_at?: string
      }
      Relationships: []
    }
    worlds: {
      Row: {
      id: string
      campaign_id: string | null
      name: string
      description: string | null
      climate_type: string | null
      magic_level: string | null
      technology_level: string | null
      created_at: string | null
      updated_at: string | null
      }
      Insert: {
      id?: string
      campaign_id?: string | null
      name: string
      description?: string | null
      climate_type?: string | null
      magic_level?: string | null
      technology_level?: string | null
      created_at?: string | null
      updated_at?: string | null
      }
      Update: {
      id?: string
      campaign_id?: string | null
      name?: string
      description?: string | null
      climate_type?: string | null
      magic_level?: string | null
      technology_level?: string | null
      created_at?: string | null
      updated_at?: string | null
      }
      Relationships: []
    }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
