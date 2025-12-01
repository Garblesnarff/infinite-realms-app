Connecting to localhost 54321
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      blog_authors: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string
          id: string
          linkedin_url: string | null
          metadata: Json
          short_bio: string | null
          slug: string
          twitter_handle: string | null
          updated_at: string | null
          user_id: string | null
          website_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name: string
          id?: string
          linkedin_url?: string | null
          metadata?: Json
          short_bio?: string | null
          slug: string
          twitter_handle?: string | null
          updated_at?: string | null
          user_id?: string | null
          website_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string
          id?: string
          linkedin_url?: string | null
          metadata?: Json
          short_bio?: string | null
          slug?: string
          twitter_handle?: string | null
          updated_at?: string | null
          user_id?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      blog_categories: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          metadata: Json
          name: string
          seo_description: string | null
          seo_title: string | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          name: string
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          name?: string
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      blog_post_categories: {
        Row: {
          assigned_at: string | null
          category_id: string
          post_id: string
        }
        Insert: {
          assigned_at?: string | null
          category_id: string
          post_id: string
        }
        Update: {
          assigned_at?: string | null
          category_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_post_categories_category_id_blog_categories_id_fk"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "blog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_post_categories_post_id_blog_posts_id_fk"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_post_tags: {
        Row: {
          assigned_at: string | null
          post_id: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string | null
          post_id: string
          tag_id: string
        }
        Update: {
          assigned_at?: string | null
          post_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_post_tags_post_id_blog_posts_id_fk"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_post_tags_tag_id_blog_tags_id_fk"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "blog_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          author_id: string
          canonical_url: string | null
          content: string | null
          created_at: string | null
          featured_image_url: string | null
          hero_image_alt: string | null
          id: string
          metadata: Json
          published_at: string | null
          scheduled_for: string | null
          seo_description: string | null
          seo_keywords: string[]
          seo_title: string | null
          slug: string
          status: string
          summary: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          author_id: string
          canonical_url?: string | null
          content?: string | null
          created_at?: string | null
          featured_image_url?: string | null
          hero_image_alt?: string | null
          id?: string
          metadata?: Json
          published_at?: string | null
          scheduled_for?: string | null
          seo_description?: string | null
          seo_keywords?: string[]
          seo_title?: string | null
          slug: string
          status?: string
          summary?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string
          canonical_url?: string | null
          content?: string | null
          created_at?: string | null
          featured_image_url?: string | null
          hero_image_alt?: string | null
          id?: string
          metadata?: Json
          published_at?: string | null
          scheduled_for?: string | null
          seo_description?: string | null
          seo_keywords?: string[]
          seo_title?: string | null
          slug?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_author_id_blog_authors_id_fk"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "blog_authors"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_tags: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          metadata: Json
          name: string
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          name: string
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          name?: string
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          art_style: string | null
          atmosphere: string | null
          background_image: string | null
          campaign_length: string | null
          created_at: string
          description: string | null
          difficulty_level: string | null
          enhancement_effects: Json | null
          enhancement_selections: Json | null
          era: string | null
          genre: string | null
          id: string
          location: string | null
          name: string
          rules_config: Json | null
          setting_details: Json | null
          status: string
          style_config: Json | null
          thematic_elements: Json | null
          tone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          art_style?: string | null
          atmosphere?: string | null
          background_image?: string | null
          campaign_length?: string | null
          created_at?: string
          description?: string | null
          difficulty_level?: string | null
          enhancement_effects?: Json | null
          enhancement_selections?: Json | null
          era?: string | null
          genre?: string | null
          id?: string
          location?: string | null
          name: string
          rules_config?: Json | null
          setting_details?: Json | null
          status?: string
          style_config?: Json | null
          thematic_elements?: Json | null
          tone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          art_style?: string | null
          atmosphere?: string | null
          background_image?: string | null
          campaign_length?: string | null
          created_at?: string
          description?: string | null
          difficulty_level?: string | null
          enhancement_effects?: Json | null
          enhancement_selections?: Json | null
          era?: string | null
          genre?: string | null
          id?: string
          location?: string | null
          name?: string
          rules_config?: Json | null
          setting_details?: Json | null
          status?: string
          style_config?: Json | null
          thematic_elements?: Json | null
          tone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      character_folders: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          parent_folder_id: string | null
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          parent_folder_id?: string | null
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          parent_folder_id?: string | null
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_folders_parent_folder_id_fk"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "character_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      character_permissions: {
        Row: {
          can_control_token: boolean
          can_edit_sheet: boolean
          character_id: string
          granted_at: string
          granted_by: string
          id: string
          permission_level: Database["public"]["Enums"]["permission_level"]
          user_id: string
        }
        Insert: {
          can_control_token?: boolean
          can_edit_sheet?: boolean
          character_id: string
          granted_at?: string
          granted_by: string
          id?: string
          permission_level?: Database["public"]["Enums"]["permission_level"]
          user_id: string
        }
        Update: {
          can_control_token?: boolean
          can_edit_sheet?: boolean
          character_id?: string
          granted_at?: string
          granted_by?: string
          id?: string
          permission_level?: Database["public"]["Enums"]["permission_level"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_permissions_character_id_fk"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      character_stats: {
        Row: {
          character_id: string
          charisma: number
          constitution: number
          created_at: string | null
          dexterity: number
          id: string
          intelligence: number
          strength: number
          updated_at: string | null
          wisdom: number
        }
        Insert: {
          character_id: string
          charisma?: number
          constitution?: number
          created_at?: string | null
          dexterity?: number
          id?: string
          intelligence?: number
          strength?: number
          updated_at?: string | null
          wisdom?: number
        }
        Update: {
          character_id?: string
          charisma?: number
          constitution?: number
          created_at?: string | null
          dexterity?: number
          id?: string
          intelligence?: number
          strength?: number
          updated_at?: string | null
          wisdom?: number
        }
        Relationships: [
          {
            foreignKeyName: "character_stats_character_id_characters_id_fk"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "character_tokens_character_id_fk"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_tokens_token_id_fk"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          alignment: string | null
          appearance: string | null
          avatar_url: string | null
          background: string | null
          background_image: string | null
          backstory_elements: string | null
          campaign_id: string | null
          cantrips: string | null
          class: string | null
          created_at: string | null
          description: string | null
          experience_points: number | null
          folder_id: string | null
          id: string
          image_url: string | null
          is_hidden: boolean | null
          is_public: boolean
          known_spells: string | null
          level: number
          name: string
          obscurement: string | null
          owner_id: string | null
          personality_notes: string | null
          personality_traits: string | null
          prepared_spells: string | null
          race: string | null
          ritual_spells: string | null
          sharing_mode: Database["public"]["Enums"]["sharing_mode"]
          updated_at: string | null
          user_id: string
          vision_types: string[] | null
        }
        Insert: {
          alignment?: string | null
          appearance?: string | null
          avatar_url?: string | null
          background?: string | null
          background_image?: string | null
          backstory_elements?: string | null
          campaign_id?: string | null
          cantrips?: string | null
          class?: string | null
          created_at?: string | null
          description?: string | null
          experience_points?: number | null
          folder_id?: string | null
          id?: string
          image_url?: string | null
          is_hidden?: boolean | null
          is_public?: boolean
          known_spells?: string | null
          level?: number
          name: string
          obscurement?: string | null
          owner_id?: string | null
          personality_notes?: string | null
          personality_traits?: string | null
          prepared_spells?: string | null
          race?: string | null
          ritual_spells?: string | null
          sharing_mode?: Database["public"]["Enums"]["sharing_mode"]
          updated_at?: string | null
          user_id: string
          vision_types?: string[] | null
        }
        Update: {
          alignment?: string | null
          appearance?: string | null
          avatar_url?: string | null
          background?: string | null
          background_image?: string | null
          backstory_elements?: string | null
          campaign_id?: string | null
          cantrips?: string | null
          class?: string | null
          created_at?: string | null
          description?: string | null
          experience_points?: number | null
          folder_id?: string | null
          id?: string
          image_url?: string | null
          is_hidden?: boolean | null
          is_public?: boolean
          known_spells?: string | null
          level?: number
          name?: string
          obscurement?: string | null
          owner_id?: string | null
          personality_notes?: string | null
          personality_traits?: string | null
          prepared_spells?: string | null
          race?: string | null
          ritual_spells?: string | null
          sharing_mode?: Database["public"]["Enums"]["sharing_mode"]
          updated_at?: string | null
          user_id?: string
          vision_types?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "characters_folder_id_fk"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "character_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      class_spells: {
        Row: {
          class_id: string
          created_at: string | null
          id: string
          source_feature: string | null
          spell_id: string
          spell_level: number
        }
        Insert: {
          class_id: string
          created_at?: string | null
          id?: string
          source_feature?: string | null
          spell_id: string
          spell_level: number
        }
        Update: {
          class_id?: string
          created_at?: string | null
          id?: string
          source_feature?: string | null
          spell_id?: string
          spell_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "class_spells_class_id_classes_id_fk"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_spells_spell_id_spells_id_fk"
            columns: ["spell_id"]
            isOneToOne: false
            referencedRelation: "spells"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          caster_type: string | null
          created_at: string | null
          hit_die: number
          id: string
          name: string
          ritual_casting: boolean | null
          spell_slots_start_level: number | null
          spellcasting_ability: string | null
          spellcasting_focus_type: string | null
          updated_at: string | null
        }
        Insert: {
          caster_type?: string | null
          created_at?: string | null
          hit_die: number
          id?: string
          name: string
          ritual_casting?: boolean | null
          spell_slots_start_level?: number | null
          spellcasting_ability?: string | null
          spellcasting_focus_type?: string | null
          updated_at?: string | null
        }
        Update: {
          caster_type?: string | null
          created_at?: string | null
          hit_die?: number
          id?: string
          name?: string
          ritual_casting?: boolean | null
          spell_slots_start_level?: number | null
          spellcasting_ability?: string | null
          spellcasting_focus_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dialogue_history: {
        Row: {
          context: Json | null
          created_at: string | null
          id: string
          images: Json | null
          message: string
          sequence_number: number | null
          session_id: string | null
          speaker_id: string | null
          speaker_type: string | null
          timestamp: string | null
          updated_at: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string | null
          id?: string
          images?: Json | null
          message: string
          sequence_number?: number | null
          session_id?: string | null
          speaker_id?: string | null
          speaker_type?: string | null
          timestamp?: string | null
          updated_at?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string | null
          id?: string
          images?: Json | null
          message?: string
          sequence_number?: number | null
          session_id?: string | null
          speaker_id?: string | null
          speaker_type?: string | null
          timestamp?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dialogue_history_session_id_game_sessions_id_fk"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      fog_of_war: {
        Row: {
          created_at: string
          id: string
          revealed_areas: Json
          scene_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          revealed_areas?: Json
          scene_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          revealed_areas?: Json
          scene_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fog_of_war_scene_id_fk"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      game_sessions: {
        Row: {
          campaign_id: string | null
          character_id: string | null
          created_at: string | null
          current_scene_description: string | null
          end_time: string | null
          id: string
          session_notes: string | null
          session_number: number | null
          start_time: string | null
          status: string | null
          summary: string | null
          turn_count: number | null
          updated_at: string | null
        }
        Insert: {
          campaign_id?: string | null
          character_id?: string | null
          created_at?: string | null
          current_scene_description?: string | null
          end_time?: string | null
          id?: string
          session_notes?: string | null
          session_number?: number | null
          start_time?: string | null
          status?: string | null
          summary?: string | null
          turn_count?: number | null
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string | null
          character_id?: string | null
          created_at?: string | null
          current_scene_description?: string | null
          end_time?: string | null
          id?: string
          session_notes?: string | null
          session_number?: number | null
          start_time?: string | null
          status?: string | null
          summary?: string | null
          turn_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_sessions_campaign_id_campaigns_id_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_sessions_character_id_characters_id_fk"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          campaign_id: string
          climate: string | null
          connected_locations: string[] | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          location_type: string | null
          map_url: string | null
          metadata: Json | null
          name: string
          notable_features: string[] | null
          population: number | null
          terrain: string | null
          updated_at: string | null
        }
        Insert: {
          campaign_id: string
          climate?: string | null
          connected_locations?: string[] | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          location_type?: string | null
          map_url?: string | null
          metadata?: Json | null
          name: string
          notable_features?: string[] | null
          population?: number | null
          terrain?: string | null
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string
          climate?: string | null
          connected_locations?: string[] | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          location_type?: string | null
          map_url?: string | null
          metadata?: Json | null
          name?: string
          notable_features?: string[] | null
          population?: number | null
          terrain?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_campaign_id_campaigns_id_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_templates: {
        Row: {
          color: string
          created_at: string
          created_by: string
          direction: number
          distance: number
          id: string
          is_temporary: boolean
          opacity: number
          origin_x: number
          origin_y: number
          scene_id: string
          template_type: Database["public"]["Enums"]["template_type"]
          width: number | null
        }
        Insert: {
          color?: string
          created_at?: string
          created_by: string
          direction: number
          distance: number
          id?: string
          is_temporary?: boolean
          opacity?: number
          origin_x: number
          origin_y: number
          scene_id: string
          template_type: Database["public"]["Enums"]["template_type"]
          width?: number | null
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          direction?: number
          distance?: number
          id?: string
          is_temporary?: boolean
          opacity?: number
          origin_x?: number
          origin_y?: number
          scene_id?: string
          template_type?: Database["public"]["Enums"]["template_type"]
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "measurement_templates_scene_id_fk"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      memories: {
        Row: {
          campaign_id: string | null
          content: string
          context: Json | null
          created_at: string | null
          embedding: string | null
          id: string
          importance: number | null
          memory_type: string | null
          session_id: string | null
          updated_at: string | null
        }
        Insert: {
          campaign_id?: string | null
          content: string
          context?: Json | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: number | null
          memory_type?: string | null
          session_id?: string | null
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string | null
          content?: string
          context?: Json | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: number | null
          memory_type?: string | null
          session_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memories_campaign_id_campaigns_id_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memories_session_id_game_sessions_id_fk"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      npcs: {
        Row: {
          backstory: string | null
          campaign_id: string
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          location: string | null
          name: string
          occupation: string | null
          personality: string | null
          race: string | null
          relationship: string | null
          stats: Json | null
          updated_at: string | null
          voice_id: string | null
        }
        Insert: {
          backstory?: string | null
          campaign_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          location?: string | null
          name: string
          occupation?: string | null
          personality?: string | null
          race?: string | null
          relationship?: string | null
          stats?: Json | null
          updated_at?: string | null
          voice_id?: string | null
        }
        Update: {
          backstory?: string | null
          campaign_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          location?: string | null
          name?: string
          occupation?: string | null
          personality?: string | null
          race?: string | null
          relationship?: string | null
          stats?: Json | null
          updated_at?: string | null
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "npcs_campaign_id_campaigns_id_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      quests: {
        Row: {
          campaign_id: string
          created_at: string | null
          description: string | null
          difficulty: string | null
          id: string
          location_id: string | null
          metadata: Json | null
          objectives: string[] | null
          quest_giver: string | null
          quest_type: string | null
          rewards: string[] | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string | null
          description?: string | null
          difficulty?: string | null
          id?: string
          location_id?: string | null
          metadata?: Json | null
          objectives?: string[] | null
          quest_giver?: string | null
          quest_type?: string | null
          rewards?: string[] | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string | null
          description?: string | null
          difficulty?: string | null
          id?: string
          location_id?: string | null
          metadata?: Json | null
          objectives?: string[] | null
          quest_giver?: string | null
          quest_type?: string | null
          rewards?: string[] | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quests_campaign_id_campaigns_id_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quests_location_id_locations_id_fk"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          ability_score_increases: Json | null
          created_at: string | null
          description: string | null
          id: string
          languages: string[] | null
          name: string
          size: string | null
          speed: number | null
          traits: Json | null
          updated_at: string | null
        }
        Insert: {
          ability_score_increases?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          languages?: string[] | null
          name: string
          size?: string | null
          speed?: number | null
          traits?: Json | null
          updated_at?: string | null
        }
        Update: {
          ability_score_increases?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          languages?: string[] | null
          name?: string
          size?: string | null
          speed?: number | null
          traits?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      scene_drawings: {
        Row: {
          created_at: string
          created_by: string
          drawing_type: Database["public"]["Enums"]["drawing_type"]
          fill_color: string | null
          fill_opacity: number
          font_family: string | null
          font_size: number | null
          id: string
          points_data: Json
          scene_id: string
          stroke_color: string
          stroke_width: number
          text_content: string | null
          updated_at: string
          z_index: number
        }
        Insert: {
          created_at?: string
          created_by: string
          drawing_type: Database["public"]["Enums"]["drawing_type"]
          fill_color?: string | null
          fill_opacity?: number
          font_family?: string | null
          font_size?: number | null
          id?: string
          points_data: Json
          scene_id: string
          stroke_color: string
          stroke_width: number
          text_content?: string | null
          updated_at?: string
          z_index?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          drawing_type?: Database["public"]["Enums"]["drawing_type"]
          fill_color?: string | null
          fill_opacity?: number
          font_family?: string | null
          font_size?: number | null
          id?: string
          points_data?: Json
          scene_id?: string
          stroke_color?: string
          stroke_width?: number
          text_content?: string | null
          updated_at?: string
          z_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "scene_drawings_scene_id_fk"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_layers: {
        Row: {
          created_at: string
          id: string
          is_visible: boolean
          layer_type: string
          locked: boolean
          opacity: number
          scene_id: string
          updated_at: string
          z_index: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_visible?: boolean
          layer_type: string
          locked?: boolean
          opacity?: number
          scene_id: string
          updated_at?: string
          z_index: number
        }
        Update: {
          created_at?: string
          id?: string
          is_visible?: boolean
          layer_type?: string
          locked?: boolean
          opacity?: number
          scene_id?: string
          updated_at?: string
          z_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "scene_layers_scene_id_fk"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_settings: {
        Row: {
          ambient_light_level: number
          created_at: string
          darkness_level: number
          enable_dynamic_lighting: boolean
          enable_fog_of_war: boolean
          grid_opacity: number
          id: string
          scene_id: string
          snap_to_grid: boolean
          time_of_day: string | null
          updated_at: string
          weather_effects: string | null
        }
        Insert: {
          ambient_light_level?: number
          created_at?: string
          darkness_level?: number
          enable_dynamic_lighting?: boolean
          enable_fog_of_war?: boolean
          grid_opacity?: number
          id?: string
          scene_id: string
          snap_to_grid?: boolean
          time_of_day?: string | null
          updated_at?: string
          weather_effects?: string | null
        }
        Update: {
          ambient_light_level?: number
          created_at?: string
          darkness_level?: number
          enable_dynamic_lighting?: boolean
          enable_fog_of_war?: boolean
          grid_opacity?: number
          id?: string
          scene_id?: string
          snap_to_grid?: boolean
          time_of_day?: string | null
          updated_at?: string
          weather_effects?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scene_settings_scene_id_fk"
            columns: ["scene_id"]
            isOneToOne: true
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          background_image_url: string | null
          campaign_id: string
          created_at: string
          description: string | null
          grid_color: string | null
          grid_size: number
          grid_type: string
          height: number
          id: string
          is_active: boolean
          name: string
          thumbnail_url: string | null
          updated_at: string
          user_id: string
          width: number
        }
        Insert: {
          background_image_url?: string | null
          campaign_id: string
          created_at?: string
          description?: string | null
          grid_color?: string | null
          grid_size?: number
          grid_type?: string
          height: number
          id?: string
          is_active?: boolean
          name: string
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
          width: number
        }
        Update: {
          background_image_url?: string | null
          campaign_id?: string
          created_at?: string
          description?: string | null
          grid_color?: string | null
          grid_size?: number
          grid_type?: string
          height?: number
          id?: string
          is_active?: boolean
          name?: string
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "scenes_campaign_id_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      spells: {
        Row: {
          area_of_effect: Json | null
          attack_type: string | null
          casting_time: string
          components_material: boolean | null
          components_somatic: boolean | null
          components_verbal: boolean | null
          concentration: boolean | null
          created_at: string | null
          damage_at_slot_level: Json | null
          damage_type: string | null
          description: string
          duration: string
          heal_at_slot_level: Json | null
          higher_level_text: string | null
          id: string
          level: number
          material_components: string | null
          material_consumed: boolean | null
          material_cost_gp: number | null
          name: string
          range_text: string
          ritual: boolean | null
          school: string
          updated_at: string | null
        }
        Insert: {
          area_of_effect?: Json | null
          attack_type?: string | null
          casting_time: string
          components_material?: boolean | null
          components_somatic?: boolean | null
          components_verbal?: boolean | null
          concentration?: boolean | null
          created_at?: string | null
          damage_at_slot_level?: Json | null
          damage_type?: string | null
          description: string
          duration: string
          heal_at_slot_level?: Json | null
          higher_level_text?: string | null
          id?: string
          level: number
          material_components?: string | null
          material_consumed?: boolean | null
          material_cost_gp?: number | null
          name: string
          range_text: string
          ritual?: boolean | null
          school: string
          updated_at?: string | null
        }
        Update: {
          area_of_effect?: Json | null
          attack_type?: string | null
          casting_time?: string
          components_material?: boolean | null
          components_somatic?: boolean | null
          components_verbal?: boolean | null
          concentration?: boolean | null
          created_at?: string | null
          damage_at_slot_level?: Json | null
          damage_type?: string | null
          description?: string
          duration?: string
          heal_at_slot_level?: Json | null
          higher_level_text?: string | null
          id?: string
          level?: number
          material_components?: string | null
          material_consumed?: boolean | null
          material_cost_gp?: number | null
          name?: string
          range_text?: string
          ritual?: boolean | null
          school?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      token_configurations: {
        Row: {
          avatar_url: string | null
          border_color: string | null
          border_width: number | null
          bright_light_range: number | null
          character_id: string | null
          created_at: string
          darkvision_range: number | null
          dim_light_range: number | null
          emits_light: boolean | null
          grid_size: string | null
          has_flying: boolean | null
          has_swimming: boolean | null
          id: string
          image_url: string | null
          light_angle: number | null
          light_color: string | null
          light_intensity: number | null
          light_range: number | null
          monster_id: string | null
          movement_speed: number | null
          nameplate_position: string | null
          night_vision: boolean | null
          opacity: number | null
          scale: number | null
          show_nameplate: boolean | null
          size_height: number | null
          size_width: number | null
          tint_color: string | null
          updated_at: string
          vision_angle: number | null
          vision_enabled: boolean | null
          vision_range: number | null
        }
        Insert: {
          avatar_url?: string | null
          border_color?: string | null
          border_width?: number | null
          bright_light_range?: number | null
          character_id?: string | null
          created_at?: string
          darkvision_range?: number | null
          dim_light_range?: number | null
          emits_light?: boolean | null
          grid_size?: string | null
          has_flying?: boolean | null
          has_swimming?: boolean | null
          id?: string
          image_url?: string | null
          light_angle?: number | null
          light_color?: string | null
          light_intensity?: number | null
          light_range?: number | null
          monster_id?: string | null
          movement_speed?: number | null
          nameplate_position?: string | null
          night_vision?: boolean | null
          opacity?: number | null
          scale?: number | null
          show_nameplate?: boolean | null
          size_height?: number | null
          size_width?: number | null
          tint_color?: string | null
          updated_at?: string
          vision_angle?: number | null
          vision_enabled?: boolean | null
          vision_range?: number | null
        }
        Update: {
          avatar_url?: string | null
          border_color?: string | null
          border_width?: number | null
          bright_light_range?: number | null
          character_id?: string | null
          created_at?: string
          darkvision_range?: number | null
          dim_light_range?: number | null
          emits_light?: boolean | null
          grid_size?: string | null
          has_flying?: boolean | null
          has_swimming?: boolean | null
          id?: string
          image_url?: string | null
          light_angle?: number | null
          light_color?: string | null
          light_intensity?: number | null
          light_range?: number | null
          monster_id?: string | null
          movement_speed?: number | null
          nameplate_position?: string | null
          night_vision?: boolean | null
          opacity?: number | null
          scale?: number | null
          show_nameplate?: boolean | null
          size_height?: number | null
          size_width?: number | null
          tint_color?: string | null
          updated_at?: string
          vision_angle?: number | null
          vision_enabled?: boolean | null
          vision_range?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "token_configurations_character_id_fk"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: {
          actor_id: string | null
          avatar_url: string | null
          border_color: string | null
          border_width: number | null
          bright_light_range: number | null
          created_at: string
          created_by: string
          darkvision_range: number | null
          dim_light_range: number | null
          elevation: number | null
          emits_light: boolean | null
          grid_size: string
          has_flying: boolean | null
          has_swimming: boolean | null
          id: string
          image_url: string | null
          is_hidden: boolean | null
          is_locked: boolean | null
          is_visible: boolean | null
          light_angle: number | null
          light_color: string | null
          light_intensity: number | null
          light_range: number | null
          movement_speed: number | null
          name: string
          nameplate_position: string | null
          night_vision: boolean | null
          opacity: number | null
          position_x: number
          position_y: number
          rotation: number | null
          scale: number | null
          scene_id: string
          show_nameplate: boolean | null
          size_height: number
          size_width: number
          tint_color: string | null
          token_type: string
          updated_at: string
          vision_angle: number | null
          vision_enabled: boolean | null
          vision_range: number | null
        }
        Insert: {
          actor_id?: string | null
          avatar_url?: string | null
          border_color?: string | null
          border_width?: number | null
          bright_light_range?: number | null
          created_at?: string
          created_by: string
          darkvision_range?: number | null
          dim_light_range?: number | null
          elevation?: number | null
          emits_light?: boolean | null
          grid_size: string
          has_flying?: boolean | null
          has_swimming?: boolean | null
          id?: string
          image_url?: string | null
          is_hidden?: boolean | null
          is_locked?: boolean | null
          is_visible?: boolean | null
          light_angle?: number | null
          light_color?: string | null
          light_intensity?: number | null
          light_range?: number | null
          movement_speed?: number | null
          name: string
          nameplate_position?: string | null
          night_vision?: boolean | null
          opacity?: number | null
          position_x: number
          position_y: number
          rotation?: number | null
          scale?: number | null
          scene_id: string
          show_nameplate?: boolean | null
          size_height: number
          size_width: number
          tint_color?: string | null
          token_type: string
          updated_at?: string
          vision_angle?: number | null
          vision_enabled?: boolean | null
          vision_range?: number | null
        }
        Update: {
          actor_id?: string | null
          avatar_url?: string | null
          border_color?: string | null
          border_width?: number | null
          bright_light_range?: number | null
          created_at?: string
          created_by?: string
          darkvision_range?: number | null
          dim_light_range?: number | null
          elevation?: number | null
          emits_light?: boolean | null
          grid_size?: string
          has_flying?: boolean | null
          has_swimming?: boolean | null
          id?: string
          image_url?: string | null
          is_hidden?: boolean | null
          is_locked?: boolean | null
          is_visible?: boolean | null
          light_angle?: number | null
          light_color?: string | null
          light_intensity?: number | null
          light_range?: number | null
          movement_speed?: number | null
          name?: string
          nameplate_position?: string | null
          night_vision?: boolean | null
          opacity?: number | null
          position_x?: number
          position_y?: number
          rotation?: number | null
          scale?: number | null
          scene_id?: string
          show_nameplate?: boolean | null
          size_height?: number
          size_width?: number
          tint_color?: string | null
          token_type?: string
          updated_at?: string
          vision_angle?: number | null
          vision_enabled?: boolean | null
          vision_range?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tokens_scene_id_fk"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name?: string | null
          id: string
          last_name?: string | null
          plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      vision_blocking_shapes: {
        Row: {
          blocks_light: boolean
          blocks_movement: boolean
          blocks_vision: boolean
          created_at: string
          created_by: string
          door_state: string | null
          id: string
          is_one_way: boolean
          points_data: Json
          scene_id: string
          shape_type: string
          updated_at: string
        }
        Insert: {
          blocks_light?: boolean
          blocks_movement?: boolean
          blocks_vision?: boolean
          created_at?: string
          created_by: string
          door_state?: string | null
          id?: string
          is_one_way?: boolean
          points_data: Json
          scene_id: string
          shape_type: string
          updated_at?: string
        }
        Update: {
          blocks_light?: boolean
          blocks_movement?: boolean
          blocks_vision?: boolean
          created_at?: string
          created_by?: string
          door_state?: string | null
          id?: string
          is_one_way?: boolean
          points_data?: Json
          scene_id?: string
          shape_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vision_blocking_shapes_scene_id_fk"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      pg_stat_statements: {
        Row: {
          blk_read_time: number | null
          blk_write_time: number | null
          calls: number | null
          dbid: unknown
          jit_emission_count: number | null
          jit_emission_time: number | null
          jit_functions: number | null
          jit_generation_time: number | null
          jit_inlining_count: number | null
          jit_inlining_time: number | null
          jit_optimization_count: number | null
          jit_optimization_time: number | null
          local_blks_dirtied: number | null
          local_blks_hit: number | null
          local_blks_read: number | null
          local_blks_written: number | null
          max_exec_time: number | null
          max_plan_time: number | null
          mean_exec_time: number | null
          mean_plan_time: number | null
          min_exec_time: number | null
          min_plan_time: number | null
          plans: number | null
          query: string | null
          queryid: number | null
          rows: number | null
          shared_blks_dirtied: number | null
          shared_blks_hit: number | null
          shared_blks_read: number | null
          shared_blks_written: number | null
          stddev_exec_time: number | null
          stddev_plan_time: number | null
          temp_blk_read_time: number | null
          temp_blk_write_time: number | null
          temp_blks_read: number | null
          temp_blks_written: number | null
          toplevel: boolean | null
          total_exec_time: number | null
          total_plan_time: number | null
          userid: unknown
          wal_bytes: number | null
          wal_fpi: number | null
          wal_records: number | null
        }
        Relationships: []
      }
      pg_stat_statements_info: {
        Row: {
          dealloc: number | null
          stats_reset: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      algorithm_sign: {
        Args: { algorithm: string; secret: string; signables: string }
        Returns: string
      }
      dearmor: { Args: { "": string }; Returns: string }
      gen_random_uuid: { Args: never; Returns: string }
      gen_salt: { Args: { "": string }; Returns: string }
      pg_stat_statements: {
        Args: { showtext: boolean }
        Returns: Record<string, unknown>[]
      }
      pg_stat_statements_info: { Args: never; Returns: Record<string, unknown> }
      pg_stat_statements_reset: {
        Args: { dbid?: unknown; queryid?: number; userid?: unknown }
        Returns: undefined
      }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      sign: {
        Args: { algorithm?: string; payload: Json; secret: string }
        Returns: string
      }
      try_cast_double: { Args: { inp: string }; Returns: number }
      url_decode: { Args: { data: string }; Returns: string }
      url_encode: { Args: { data: string }; Returns: string }
      uuid_generate_v1: { Args: never; Returns: string }
      uuid_generate_v1mc: { Args: never; Returns: string }
      uuid_generate_v3: {
        Args: { name: string; namespace: string }
        Returns: string
      }
      uuid_generate_v4: { Args: never; Returns: string }
      uuid_generate_v5: {
        Args: { name: string; namespace: string }
        Returns: string
      }
      uuid_nil: { Args: never; Returns: string }
      uuid_ns_dns: { Args: never; Returns: string }
      uuid_ns_oid: { Args: never; Returns: string }
      uuid_ns_url: { Args: never; Returns: string }
      uuid_ns_x500: { Args: never; Returns: string }
      verify: {
        Args: { algorithm?: string; secret: string; token: string }
        Returns: {
          header: Json
          payload: Json
          valid: boolean
        }[]
      }
    }
    Enums: {
      drawing_type:
        | "freehand"
        | "line"
        | "circle"
        | "rectangle"
        | "polygon"
        | "text"
      permission_level: "viewer" | "editor" | "owner"
      sharing_mode: "private" | "view_only" | "can_edit" | "co_owner"
      template_type: "cone" | "cube" | "sphere" | "cylinder" | "line" | "ray"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      drawing_type: [
        "freehand",
        "line",
        "circle",
        "rectangle",
        "polygon",
        "text",
      ],
      permission_level: ["viewer", "editor", "owner"],
      sharing_mode: ["private", "view_only", "can_edit", "co_owner"],
      template_type: ["cone", "cube", "sphere", "cylinder", "line", "ray"],
    },
  },
} as const

