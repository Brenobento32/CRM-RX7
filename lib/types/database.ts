export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
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
      agenda_google_conexao: {
        Row: {
          calendar_id: string
          conectado_em: string
          conectado_por: string | null
          conta_email: string
          escopos: string[]
          id: boolean
          ultimo_erro: string | null
          ultimo_erro_em: string | null
          updated_at: string
          vault_secret_id: string
        }
        Insert: {
          calendar_id: string
          conectado_em?: string
          conectado_por?: string | null
          conta_email: string
          escopos: string[]
          id?: boolean
          ultimo_erro?: string | null
          ultimo_erro_em?: string | null
          updated_at?: string
          vault_secret_id: string
        }
        Update: {
          calendar_id?: string
          conectado_em?: string
          conectado_por?: string | null
          conta_email?: string
          escopos?: string[]
          id?: boolean
          ultimo_erro?: string | null
          ultimo_erro_em?: string | null
          updated_at?: string
          vault_secret_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_google_conexao_conectado_por_fkey"
            columns: ["conectado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_google_oauth_estados: {
        Row: {
          created_at: string
          expira_em: string
          nonce: string
          retorno: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          expira_em?: string
          nonce: string
          retorno: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          expira_em?: string
          nonce?: string
          retorno?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_google_oauth_estados_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      atividades: {
        Row: {
          cliente_id: string
          created_at: string
          data: string
          descricao: string
          id: string
          negociacao_id: string | null
          tipo: Database["public"]["Enums"]["tipo_atividade"]
          usuario_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          data?: string
          descricao: string
          id?: string
          negociacao_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_atividade"]
          usuario_id?: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          negociacao_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_atividade"]
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atividades_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atividades_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "atividades_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atividades_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atividades_owner_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          cargo: string | null
          cnpj: string | null
          cpf: string | null
          created_at: string
          deleted_at: string | null
          documento: string | null
          email: string | null
          empresa: string | null
          id: string
          nome: string
          observacoes: string | null
          origem: string | null
          owner_id: string
          responsavel: string | null
          telefone: string | null
          tipo_cliente: Database["public"]["Enums"]["tipo_cliente"]
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          cargo?: string | null
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          documento?: string | null
          email?: string | null
          empresa?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          origem?: string | null
          owner_id: string
          responsavel?: string | null
          telefone?: string | null
          tipo_cliente?: Database["public"]["Enums"]["tipo_cliente"]
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          cargo?: string | null
          cnpj?: string | null
          cpf?: string | null
          created_at?: string
          deleted_at?: string | null
          documento?: string | null
          email?: string | null
          empresa?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          origem?: string | null
          owner_id?: string
          responsavel?: string | null
          telefone?: string | null
          tipo_cliente?: Database["public"]["Enums"]["tipo_cliente"]
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      etapas_funil: {
        Row: {
          ativo: boolean
          chave: string | null
          cor: Database["public"]["Enums"]["cor_etapa"]
          created_at: string
          criado_por: string | null
          id: string
          nome: string
          ordem: number
          sistema: boolean
          tipo: Database["public"]["Enums"]["tipo_etapa"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          chave?: string | null
          cor: Database["public"]["Enums"]["cor_etapa"]
          created_at?: string
          criado_por?: string | null
          id?: string
          nome: string
          ordem: number
          sistema?: boolean
          tipo?: Database["public"]["Enums"]["tipo_etapa"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          chave?: string | null
          cor?: Database["public"]["Enums"]["cor_etapa"]
          created_at?: string
          criado_por?: string | null
          id?: string
          nome?: string
          ordem?: number
          sistema?: boolean
          tipo?: Database["public"]["Enums"]["tipo_etapa"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "etapas_funil_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos: {
        Row: {
          cliente_id: string
          created_at: string
          criado_por: string | null
          descricao: string | null
          fim: string
          google_etag: string | null
          google_event_id: string | null
          id: string
          inicio: string
          negociacao_id: string | null
          ocorrencia_original: string | null
          origem: Database["public"]["Enums"]["origem_evento"]
          serie_id: string | null
          sincronizado_em: string | null
          status: Database["public"]["Enums"]["status_evento"]
          tipo: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at: string
          usuario_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          fim: string
          google_etag?: string | null
          google_event_id?: string | null
          id?: string
          inicio: string
          negociacao_id?: string | null
          ocorrencia_original?: string | null
          origem?: Database["public"]["Enums"]["origem_evento"]
          serie_id?: string | null
          sincronizado_em?: string | null
          status?: Database["public"]["Enums"]["status_evento"]
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at?: string
          usuario_id?: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          fim?: string
          google_etag?: string | null
          google_event_id?: string | null
          id?: string
          inicio?: string
          negociacao_id?: string | null
          ocorrencia_original?: string | null
          origem?: Database["public"]["Enums"]["origem_evento"]
          serie_id?: string | null
          sincronizado_em?: string | null
          status?: Database["public"]["Enums"]["status_evento"]
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          titulo?: string
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "eventos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_owner_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_serie_id_fkey"
            columns: ["serie_id"]
            isOneToOne: false
            referencedRelation: "eventos_series"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_series: {
        Row: {
          cliente_id: string
          created_at: string
          criado_por: string | null
          data_inicio: string
          descricao: string | null
          dia_mes: number | null
          dias_semana: number[] | null
          duracao: string
          frequencia: Database["public"]["Enums"]["frequencia_recorrencia"]
          fuso: string
          hora_inicio: string
          id: string
          intervalo: number
          negociacao_id: string | null
          ocorrencias: number | null
          termina_em: string | null
          tipo: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at: string
          usuario_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          criado_por?: string | null
          data_inicio: string
          descricao?: string | null
          dia_mes?: number | null
          dias_semana?: number[] | null
          duracao: string
          frequencia: Database["public"]["Enums"]["frequencia_recorrencia"]
          fuso?: string
          hora_inicio: string
          id?: string
          intervalo?: number
          negociacao_id?: string | null
          ocorrencias?: number | null
          termina_em?: string | null
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at?: string
          usuario_id: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          criado_por?: string | null
          data_inicio?: string
          descricao?: string | null
          dia_mes?: number | null
          dias_semana?: number[] | null
          duracao?: string
          frequencia?: Database["public"]["Enums"]["frequencia_recorrencia"]
          fuso?: string
          hora_inicio?: string
          id?: string
          intervalo?: number
          negociacao_id?: string | null
          ocorrencias?: number | null
          termina_em?: string | null
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          titulo?: string
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eventos_series_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_series_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "eventos_series_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_series_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_series_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_series_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fechamentos: {
        Row: {
          contrato_assinado: boolean
          contrato_assinado_em: string | null
          contrato_enviado: boolean
          contrato_enviado_em: string | null
          created_at: string
          data_fechamento: string
          fechado_em: string
          fechado_por: string
          link_contrato: string | null
          negociacao_id: string
          responsavel_id: string
          status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          updated_at: string
          valor_vendido: number
        }
        Insert: {
          contrato_assinado: boolean
          contrato_assinado_em?: string | null
          contrato_enviado: boolean
          contrato_enviado_em?: string | null
          created_at?: string
          data_fechamento: string
          fechado_em?: string
          fechado_por?: string
          link_contrato?: string | null
          negociacao_id: string
          responsavel_id: string
          status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          updated_at?: string
          valor_vendido: number
        }
        Update: {
          contrato_assinado?: boolean
          contrato_assinado_em?: string | null
          contrato_enviado?: boolean
          contrato_enviado_em?: string | null
          created_at?: string
          data_fechamento?: string
          fechado_em?: string
          fechado_por?: string
          link_contrato?: string | null
          negociacao_id?: string
          responsavel_id?: string
          status_onboarding?: Database["public"]["Enums"]["status_onboarding"]
          status_pagamento?: Database["public"]["Enums"]["status_pagamento"]
          updated_at?: string
          valor_vendido?: number
        }
        Relationships: [
          {
            foreignKeyName: "fechamentos_fechado_por_fkey"
            columns: ["fechado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fechamentos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: true
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fechamentos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: true
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fechamentos_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_etapas: {
        Row: {
          created_at: string
          etapa_anterior_id: string | null
          etapa_nova_id: string
          id: number
          negociacao_id: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          etapa_anterior_id?: string | null
          etapa_nova_id: string
          id?: never
          negociacao_id: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          etapa_anterior_id?: string | null
          etapa_nova_id?: string
          id?: never
          negociacao_id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historico_etapas_etapa_anterior_id_fkey"
            columns: ["etapa_anterior_id"]
            isOneToOne: false
            referencedRelation: "etapas_funil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_etapas_etapa_nova_id_fkey"
            columns: ["etapa_nova_id"]
            isOneToOne: false
            referencedRelation: "etapas_funil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_etapas_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_etapas_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_etapas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      metas: {
        Row: {
          created_at: string
          criado_por: string
          id: string
          periodo_mes: string
          updated_at: string
          usuario_id: string | null
          valor_meta: number
        }
        Insert: {
          created_at?: string
          criado_por?: string
          id?: string
          periodo_mes: string
          updated_at?: string
          usuario_id?: string | null
          valor_meta: number
        }
        Update: {
          created_at?: string
          criado_por?: string
          id?: string
          periodo_mes?: string
          updated_at?: string
          usuario_id?: string | null
          valor_meta?: number
        }
        Relationships: [
          {
            foreignKeyName: "metas_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      negociacao_servicos: {
        Row: {
          created_at: string
          negociacao_id: string
          servico_id: string
        }
        Insert: {
          created_at?: string
          negociacao_id: string
          servico_id: string
        }
        Update: {
          created_at?: string
          negociacao_id?: string
          servico_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negociacao_servicos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacao_servicos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacao_servicos_servico_id_fkey"
            columns: ["servico_id"]
            isOneToOne: false
            referencedRelation: "servicos"
            referencedColumns: ["id"]
          },
        ]
      }
      negociacoes: {
        Row: {
          cliente_id: string
          created_at: string
          data_entrada_etapa: string
          data_primeira_reuniao: string | null
          data_proposta: string | null
          etapa_id: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          id: string
          motivo_perda: string | null
          objecao_principal: string | null
          owner_id: string
          posicao: number
          temperatura:
            | Database["public"]["Enums"]["temperatura_negociacao"]
            | null
          titulo: string | null
          updated_at: string
          valor_estimado: number | null
          valor_proposta: number | null
        }
        Insert: {
          cliente_id: string
          created_at?: string
          data_entrada_etapa?: string
          data_primeira_reuniao?: string | null
          data_proposta?: string | null
          etapa_id?: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          motivo_perda?: string | null
          objecao_principal?: string | null
          owner_id: string
          posicao?: number
          temperatura?:
            | Database["public"]["Enums"]["temperatura_negociacao"]
            | null
          titulo?: string | null
          updated_at?: string
          valor_estimado?: number | null
          valor_proposta?: number | null
        }
        Update: {
          cliente_id?: string
          created_at?: string
          data_entrada_etapa?: string
          data_primeira_reuniao?: string | null
          data_proposta?: string | null
          etapa_id?: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          motivo_perda?: string | null
          objecao_principal?: string | null
          owner_id?: string
          posicao?: number
          temperatura?:
            | Database["public"]["Enums"]["temperatura_negociacao"]
            | null
          titulo?: string | null
          updated_at?: string
          valor_estimado?: number | null
          valor_proposta?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "negociacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "negociacoes_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas_funil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          cor_agenda: Database["public"]["Enums"]["cor_etapa"] | null
          created_at: string
          email: string
          foto_url: string | null
          id: string
          nome: string
          role: Database["public"]["Enums"]["user_role"]
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cor_agenda?: Database["public"]["Enums"]["cor_etapa"] | null
          created_at?: string
          email: string
          foto_url?: string | null
          id: string
          nome: string
          role?: Database["public"]["Enums"]["user_role"]
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cor_agenda?: Database["public"]["Enums"]["cor_etapa"] | null
          created_at?: string
          email?: string
          foto_url?: string | null
          id?: string
          nome?: string
          role?: Database["public"]["Enums"]["user_role"]
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      proximas_acoes: {
        Row: {
          cliente_id: string
          concluida_em: string | null
          created_at: string
          data: string
          id: string
          negociacao_id: string | null
          observacao: string | null
          titulo: string
          updated_at: string
          usuario_id: string
        }
        Insert: {
          cliente_id: string
          concluida_em?: string | null
          created_at?: string
          data: string
          id?: string
          negociacao_id?: string | null
          observacao?: string | null
          titulo: string
          updated_at?: string
          usuario_id?: string
        }
        Update: {
          cliente_id?: string
          concluida_em?: string | null
          created_at?: string
          data?: string
          id?: string
          negociacao_id?: string | null
          observacao?: string | null
          titulo?: string
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proximas_acoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proximas_acoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "proximas_acoes_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proximas_acoes_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proximas_acoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      servicos: {
        Row: {
          ativo: boolean
          categoria: string | null
          created_at: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      agenda_eventos: {
        Row: {
          cliente_empresa: string | null
          cliente_id: string | null
          cliente_nome: string | null
          descricao: string | null
          fim: string | null
          google_event_id: string | null
          id: string | null
          inicio: string | null
          negociacao_id: string | null
          negociacao_titulo: string | null
          ocorrencia_original: string | null
          origem: Database["public"]["Enums"]["origem_evento"] | null
          responsavel_cor: Database["public"]["Enums"]["cor_etapa"] | null
          responsavel_nome: string | null
          serie_id: string | null
          status: Database["public"]["Enums"]["status_evento"] | null
          tipo: Database["public"]["Enums"]["tipo_evento"] | null
          titulo: string | null
          usuario_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "eventos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_owner_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_serie_id_fkey"
            columns: ["serie_id"]
            isOneToOne: false
            referencedRelation: "eventos_series"
            referencedColumns: ["id"]
          },
        ]
      }
      funil_cards: {
        Row: {
          cliente_empresa: string | null
          cliente_id: string | null
          cliente_nome: string | null
          data_entrada_etapa: string | null
          etapa_cor: Database["public"]["Enums"]["cor_etapa"] | null
          etapa_id: string | null
          etapa_nome: string | null
          etapa_tipo: Database["public"]["Enums"]["tipo_etapa"] | null
          id: string | null
          owner_id: string | null
          posicao: number | null
          proxima_acao_data: string | null
          proxima_acao_titulo: string | null
          responsavel_nome: string | null
          temperatura:
            | Database["public"]["Enums"]["temperatura_negociacao"]
            | null
          ultima_atividade_data: string | null
          ultima_atividade_descricao: string | null
          ultima_atividade_tipo:
            | Database["public"]["Enums"]["tipo_atividade"]
            | null
          valor_estimado: number | null
        }
        Relationships: [
          {
            foreignKeyName: "negociacoes_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas_funil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      agenda_alvos: {
        Args: {
          p_escopo: string
          p_evento: Database["public"]["Tables"]["eventos"]["Row"]
        }
        Returns: string[]
      }
      agenda_google_obter_credencial: {
        Args: never
        Returns: {
          calendar_id: string
          conta_email: string
          refresh_token: string
        }[]
      }
      agenda_google_registrar_erro: {
        Args: { p_erro: string }
        Returns: undefined
      }
      agenda_google_remover_conexao: { Args: never; Returns: undefined }
      agenda_google_salvar_conexao: {
        Args: {
          p_calendar_id: string
          p_conta_email: string
          p_escopos: string[]
          p_refresh_token: string
          p_usuario_id: string
        }
        Returns: undefined
      }
      alterar_eventos: {
        Args: {
          p_cliente_id: string
          p_data: string
          p_descricao: string
          p_duracao_minutos: number
          p_escopo: string
          p_evento_id: string
          p_hora_inicio: string
          p_negociacao_id: string
          p_tipo: Database["public"]["Enums"]["tipo_evento"]
          p_titulo: string
          p_usuario_id: string
        }
        Returns: number
      }
      alterar_status_evento: {
        Args: {
          p_evento_id: string
          p_status: Database["public"]["Enums"]["status_evento"]
        }
        Returns: undefined
      }
      cancelar_eventos: {
        Args: { p_escopo: string; p_evento_id: string }
        Returns: number
      }
      cliente_owner: { Args: { p_cliente_id: string }; Returns: string }
      criar_cliente: {
        Args: {
          p_cargo?: string
          p_cnpj?: string
          p_cpf?: string
          p_email?: string
          p_empresa?: string
          p_nome: string
          p_observacoes?: string
          p_owner_id?: string
          p_responsavel?: string
          p_telefone?: string
          p_tipo_cliente: Database["public"]["Enums"]["tipo_cliente"]
          p_whatsapp?: string
        }
        Returns: string
      }
      criar_serie_eventos: {
        Args: {
          p_cliente_id: string
          p_data_inicio: string
          p_descricao: string
          p_dia_mes: number
          p_dias_semana: number[]
          p_duracao_minutos: number
          p_frequencia: Database["public"]["Enums"]["frequencia_recorrencia"]
          p_hora_inicio: string
          p_intervalo: number
          p_negociacao_id: string
          p_ocorrencias: number
          p_status: Database["public"]["Enums"]["status_evento"]
          p_termina_em: string
          p_tipo: Database["public"]["Enums"]["tipo_evento"]
          p_titulo: string
          p_usuario_id: string
        }
        Returns: string
      }
      dashboard_etapas: {
        Args: { p_fim: string; p_inicio: string }
        Returns: {
          cor: Database["public"]["Enums"]["cor_etapa"]
          etapa_id: string
          nome: string
          ordem: number
          quantidade: number
          tipo: Database["public"]["Enums"]["tipo_etapa"]
          valor: number
        }[]
      }
      dashboard_por_usuario: {
        Args: { p_fim: string; p_inicio: string }
        Returns: {
          abertas: number
          atividades: number
          ganhos: number
          nome: string
          perdidos: number
          pipeline_valor: number
          reunioes_proximas: number
          reunioes_realizadas: number
          role: Database["public"]["Enums"]["user_role"]
          usuario_id: string
          vendido_valor: number
        }[]
      }
      dashboard_vendas_mensais: {
        Args: { p_meses?: number }
        Returns: {
          mes: string
          quantidade: number
          valor: number
        }[]
      }
      etapa_id_por_chave: { Args: { p_chave: string }; Returns: string }
      etapa_tipo: {
        Args: { p_etapa_id: string }
        Returns: Database["public"]["Enums"]["tipo_etapa"]
      }
      etapas_funil_uso: {
        Args: never
        Returns: {
          etapa_id: string
          ja_usada: boolean
          negociacoes_atuais: number
        }[]
      }
      expandir_recorrencia: {
        Args: {
          p_data_inicio: string
          p_dia_mes: number
          p_dias_semana: number[]
          p_frequencia: Database["public"]["Enums"]["frequencia_recorrencia"]
          p_intervalo: number
          p_ocorrencias: number
          p_termina_em: string
        }
        Returns: {
          data: string
        }[]
      }
      fechar_negociacao: {
        Args: {
          p_contrato_assinado: boolean
          p_contrato_enviado: boolean
          p_data_fechamento: string
          p_link_contrato?: string
          p_negociacao_id: string
          p_posicao: number
          p_status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          p_status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          p_valor_vendido: number
        }
        Returns: undefined
      }
      funil_metricas: {
        Args: { p_fim: string; p_inicio: string }
        Returns: {
          alcancaram: number
          cor: Database["public"]["Enums"]["cor_etapa"]
          etapa_id: string
          nome: string
          ordem: number
          parados_7_dias: number
          parados_medio_segundos: number
          permanencias: number
          quantidade: number
          tempo_medio_segundos: number
          tipo: Database["public"]["Enums"]["tipo_etapa"]
          valor: number
        }[]
      }
      is_gerente: { Args: never; Returns: boolean }
      metas_progresso: {
        Args: { p_mes: string }
        Returns: {
          ativo: boolean
          meta_id: string
          nome: string
          realizado: number
          role: Database["public"]["Enums"]["user_role"]
          usuario_id: string
          valor_meta: number
        }[]
      }
      negociacao_owner: { Args: { p_negociacao_id: string }; Returns: string }
      nomes_de_usuarios: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          nome: string
        }[]
      }
      salvar_negociacao: {
        Args: {
          p_data_primeira_reuniao: string
          p_data_proposta: string
          p_forma_pagamento: Database["public"]["Enums"]["forma_pagamento"]
          p_negociacao_id: string
          p_objecao_principal: string
          p_servico_ids: string[]
          p_temperatura: Database["public"]["Enums"]["temperatura_negociacao"]
          p_valor_estimado: number
          p_valor_proposta: number
        }
        Returns: undefined
      }
    }
    Enums: {
      cor_etapa:
        | "azul"
        | "violeta"
        | "amarelo"
        | "laranja"
        | "verde"
        | "vermelho"
        | "ciano"
        | "rosa"
        | "turquesa"
        | "cinza"
      forma_pagamento: "avista" | "boleto_3x" | "cartao_12x"
      frequencia_recorrencia: "diaria" | "semanal" | "mensal"
      origem_evento: "crm" | "google"
      status_evento:
        | "agendado"
        | "confirmado"
        | "realizado"
        | "nao_compareceu"
        | "cancelado"
      status_onboarding: "nao_iniciado" | "em_andamento" | "concluido"
      status_pagamento:
        | "pendente"
        | "parcial"
        | "pago"
        | "atrasado"
        | "cancelado"
      temperatura_negociacao: "quente" | "morno" | "frio"
      tipo_atividade: "nota" | "ligacao" | "email" | "whatsapp" | "reuniao"
      tipo_cliente: "pessoa_fisica" | "empresa"
      tipo_etapa: "aberta" | "ganha" | "perdida"
      tipo_evento: "reuniao" | "ligacao" | "followup" | "apresentacao" | "outro"
      user_role: "gerente" | "closer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      cor_etapa: [
        "azul",
        "violeta",
        "amarelo",
        "laranja",
        "verde",
        "vermelho",
        "ciano",
        "rosa",
        "turquesa",
        "cinza",
      ],
      forma_pagamento: ["avista", "boleto_3x", "cartao_12x"],
      frequencia_recorrencia: ["diaria", "semanal", "mensal"],
      origem_evento: ["crm", "google"],
      status_evento: [
        "agendado",
        "confirmado",
        "realizado",
        "nao_compareceu",
        "cancelado",
      ],
      status_onboarding: ["nao_iniciado", "em_andamento", "concluido"],
      status_pagamento: [
        "pendente",
        "parcial",
        "pago",
        "atrasado",
        "cancelado",
      ],
      temperatura_negociacao: ["quente", "morno", "frio"],
      tipo_atividade: ["nota", "ligacao", "email", "whatsapp", "reuniao"],
      tipo_cliente: ["pessoa_fisica", "empresa"],
      tipo_etapa: ["aberta", "ganha", "perdida"],
      tipo_evento: ["reuniao", "ligacao", "followup", "apresentacao", "outro"],
      user_role: ["gerente", "closer"],
    },
  },
} as const
