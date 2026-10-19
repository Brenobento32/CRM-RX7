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
    PostgrestVersion: "14.17"
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
          excluido_em: string | null
          excluido_por: string | null
          id: string
          instagram: string | null
          motivo_exclusao: string | null
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
          excluido_em?: string | null
          excluido_por?: string | null
          id?: string
          instagram?: string | null
          motivo_exclusao?: string | null
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
          excluido_em?: string | null
          excluido_por?: string | null
          id?: string
          instagram?: string | null
          motivo_exclusao?: string | null
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
            foreignKeyName: "clientes_excluido_por_fkey"
            columns: ["excluido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversas: {
        Row: {
          cliente_id: string | null
          created_at: string
          id: string
          telefone: string
          ultima_mensagem_em: string | null
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          id?: string
          telefone: string
          ultima_mensagem_em?: string | null
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          id?: string
          telefone?: string
          ultima_mensagem_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["cliente_id"]
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
          etapa_inicial: boolean
          funil_id: string
          id: string
          nome: string
          ordem: number
          pos_fechamento: boolean
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
          etapa_inicial?: boolean
          funil_id: string
          id?: string
          nome: string
          ordem: number
          pos_fechamento?: boolean
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
          etapa_inicial?: boolean
          funil_id?: string
          id?: string
          nome?: string
          ordem?: number
          pos_fechamento?: boolean
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
          {
            foreignKeyName: "etapas_funil_funil_id_fkey"
            columns: ["funil_id"]
            isOneToOne: false
            referencedRelation: "funis"
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
          observacoes: string | null
          responsavel_id: string
          status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          tipo_venda: Database["public"]["Enums"]["tipo_venda"] | null
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
          observacoes?: string | null
          responsavel_id: string
          status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          tipo_venda?: Database["public"]["Enums"]["tipo_venda"] | null
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
          observacoes?: string | null
          responsavel_id?: string
          status_onboarding?: Database["public"]["Enums"]["status_onboarding"]
          status_pagamento?: Database["public"]["Enums"]["status_pagamento"]
          tipo_venda?: Database["public"]["Enums"]["tipo_venda"] | null
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
      formularios: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nicho_id: string
          nome: string
          slug: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nicho_id: string
          nome: string
          slug: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nicho_id?: string
          nome?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "formularios_nicho_id_fkey"
            columns: ["nicho_id"]
            isOneToOne: false
            referencedRelation: "nichos"
            referencedColumns: ["id"]
          },
        ]
      }
      funis: {
        Row: {
          ativo: boolean
          created_at: string
          criado_por: string | null
          descricao: string | null
          id: string
          nome: string
          ordem: number
          padrao: boolean
          updated_at: string
          whatsapp_habilitado: boolean
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          nome: string
          ordem?: number
          padrao?: boolean
          updated_at?: string
          whatsapp_habilitado?: boolean
        }
        Update: {
          ativo?: boolean
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          ordem?: number
          padrao?: boolean
          updated_at?: string
          whatsapp_habilitado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "funis_criado_por_fkey"
            columns: ["criado_por"]
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
      mensagem_exclusoes: {
        Row: {
          deleted_at: string
          mensagem_id: string
          usuario_id: string
        }
        Insert: {
          deleted_at?: string
          mensagem_id: string
          usuario_id: string
        }
        Update: {
          deleted_at?: string
          mensagem_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensagem_exclusoes_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "mensagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_exclusoes_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "mensagens_visiveis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_exclusoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagem_reacoes: {
        Row: {
          created_at: string
          emoji: string
          id: string
          mensagem_id: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          mensagem_id: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          mensagem_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensagem_reacoes_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "mensagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_reacoes_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "mensagens_visiveis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagem_reacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens: {
        Row: {
          arquivo_duracao_segundos: number | null
          arquivo_mime: string | null
          arquivo_nome: string | null
          arquivo_path: string | null
          arquivo_tamanho: number | null
          autor_id: string | null
          conteudo: string | null
          conversa_id: string
          created_at: string
          direcao: Database["public"]["Enums"]["direcao_mensagem"]
          encaminhada_de_id: string | null
          id: string
          resposta_a_conteudo: string | null
          resposta_a_direcao:
            | Database["public"]["Enums"]["direcao_mensagem"]
            | null
          resposta_a_id: string | null
          resposta_a_tipo: Database["public"]["Enums"]["tipo_mensagem"] | null
          status: Database["public"]["Enums"]["status_mensagem"] | null
          tipo: Database["public"]["Enums"]["tipo_mensagem"]
          whatsapp_message_id: string | null
        }
        Insert: {
          arquivo_duracao_segundos?: number | null
          arquivo_mime?: string | null
          arquivo_nome?: string | null
          arquivo_path?: string | null
          arquivo_tamanho?: number | null
          autor_id?: string | null
          conteudo?: string | null
          conversa_id: string
          created_at?: string
          direcao: Database["public"]["Enums"]["direcao_mensagem"]
          encaminhada_de_id?: string | null
          id?: string
          resposta_a_conteudo?: string | null
          resposta_a_direcao?:
            | Database["public"]["Enums"]["direcao_mensagem"]
            | null
          resposta_a_id?: string | null
          resposta_a_tipo?: Database["public"]["Enums"]["tipo_mensagem"] | null
          status?: Database["public"]["Enums"]["status_mensagem"] | null
          tipo?: Database["public"]["Enums"]["tipo_mensagem"]
          whatsapp_message_id?: string | null
        }
        Update: {
          arquivo_duracao_segundos?: number | null
          arquivo_mime?: string | null
          arquivo_nome?: string | null
          arquivo_path?: string | null
          arquivo_tamanho?: number | null
          autor_id?: string | null
          conteudo?: string | null
          conversa_id?: string
          created_at?: string
          direcao?: Database["public"]["Enums"]["direcao_mensagem"]
          encaminhada_de_id?: string | null
          id?: string
          resposta_a_conteudo?: string | null
          resposta_a_direcao?:
            | Database["public"]["Enums"]["direcao_mensagem"]
            | null
          resposta_a_id?: string | null
          resposta_a_tipo?: Database["public"]["Enums"]["tipo_mensagem"] | null
          status?: Database["public"]["Enums"]["status_mensagem"] | null
          tipo?: Database["public"]["Enums"]["tipo_mensagem"]
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_encaminhada_de_id_fkey"
            columns: ["encaminhada_de_id"]
            isOneToOne: false
            referencedRelation: "mensagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_encaminhada_de_id_fkey"
            columns: ["encaminhada_de_id"]
            isOneToOne: false
            referencedRelation: "mensagens_visiveis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_resposta_a_id_fkey"
            columns: ["resposta_a_id"]
            isOneToOne: false
            referencedRelation: "mensagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_resposta_a_id_fkey"
            columns: ["resposta_a_id"]
            isOneToOne: false
            referencedRelation: "mensagens_visiveis"
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
          tipo_meta: Database["public"]["Enums"]["tipo_venda"] | null
          updated_at: string
          usuario_id: string | null
          valor_meta: number
        }
        Insert: {
          created_at?: string
          criado_por?: string
          id?: string
          periodo_mes: string
          tipo_meta?: Database["public"]["Enums"]["tipo_venda"] | null
          updated_at?: string
          usuario_id?: string | null
          valor_meta: number
        }
        Update: {
          created_at?: string
          criado_por?: string
          id?: string
          periodo_mes?: string
          tipo_meta?: Database["public"]["Enums"]["tipo_venda"] | null
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
          arquivada_em: string | null
          atribuicao: Json | null
          cliente_id: string
          created_at: string
          data_entrada_etapa: string
          data_primeira_reuniao: string | null
          data_proposta: string | null
          etapa_id: string
          excluida_em: string | null
          excluida_por: string | null
          external_id: string | null
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          formulario_id: string | null
          funil_id: string
          id: string
          motivo_arquivamento: string | null
          motivo_exclusao: string | null
          motivo_perda: string | null
          nicho_id: string | null
          objecao_principal: string | null
          origem: Database["public"]["Enums"]["origem_negociacao"]
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
          arquivada_em?: string | null
          atribuicao?: Json | null
          cliente_id: string
          created_at?: string
          data_entrada_etapa?: string
          data_primeira_reuniao?: string | null
          data_proposta?: string | null
          etapa_id?: string
          excluida_em?: string | null
          excluida_por?: string | null
          external_id?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          formulario_id?: string | null
          funil_id: string
          id?: string
          motivo_arquivamento?: string | null
          motivo_exclusao?: string | null
          motivo_perda?: string | null
          nicho_id?: string | null
          objecao_principal?: string | null
          origem?: Database["public"]["Enums"]["origem_negociacao"]
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
          arquivada_em?: string | null
          atribuicao?: Json | null
          cliente_id?: string
          created_at?: string
          data_entrada_etapa?: string
          data_primeira_reuniao?: string | null
          data_proposta?: string | null
          etapa_id?: string
          excluida_em?: string | null
          excluida_por?: string | null
          external_id?: string | null
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          formulario_id?: string | null
          funil_id?: string
          id?: string
          motivo_arquivamento?: string | null
          motivo_exclusao?: string | null
          motivo_perda?: string | null
          nicho_id?: string | null
          objecao_principal?: string | null
          origem?: Database["public"]["Enums"]["origem_negociacao"]
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
            foreignKeyName: "negociacoes_excluida_por_fkey"
            columns: ["excluida_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_formulario_id_fkey"
            columns: ["formulario_id"]
            isOneToOne: false
            referencedRelation: "formularios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_funil_id_fkey"
            columns: ["funil_id"]
            isOneToOne: false
            referencedRelation: "funis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_nicho_id_fkey"
            columns: ["nicho_id"]
            isOneToOne: false
            referencedRelation: "nichos"
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
      nichos: {
        Row: {
          ativo: boolean
          cor: Database["public"]["Enums"]["cor_etapa"]
          created_at: string
          id: string
          nome: string
          ordem: number
          slug: string
        }
        Insert: {
          ativo?: boolean
          cor: Database["public"]["Enums"]["cor_etapa"]
          created_at?: string
          id?: string
          nome: string
          ordem?: number
          slug: string
        }
        Update: {
          ativo?: boolean
          cor?: Database["public"]["Enums"]["cor_etapa"]
          created_at?: string
          id?: string
          nome?: string
          ordem?: number
          slug?: string
        }
        Relationships: []
      }
      perguntas: {
        Row: {
          ativo: boolean
          created_at: string
          formulario_id: string
          id: string
          opcoes: Json | null
          ordem: number
          texto: string
          tipo: Database["public"]["Enums"]["tipo_pergunta"]
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          formulario_id: string
          id?: string
          opcoes?: Json | null
          ordem?: number
          texto: string
          tipo: Database["public"]["Enums"]["tipo_pergunta"]
        }
        Update: {
          ativo?: boolean
          created_at?: string
          formulario_id?: string
          id?: string
          opcoes?: Json | null
          ordem?: number
          texto?: string
          tipo?: Database["public"]["Enums"]["tipo_pergunta"]
        }
        Relationships: [
          {
            foreignKeyName: "perguntas_formulario_id_fkey"
            columns: ["formulario_id"]
            isOneToOne: false
            referencedRelation: "formularios"
            referencedColumns: ["id"]
          },
        ]
      }
      permissoes_colaborador: {
        Row: {
          created_at: string
          criado_por: string
          etapa_id: string | null
          funil_id: string
          id: string
          pode_mover: boolean | null
          pode_ver: boolean | null
          updated_at: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          criado_por?: string
          etapa_id?: string | null
          funil_id: string
          id?: string
          pode_mover?: boolean | null
          pode_ver?: boolean | null
          updated_at?: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          criado_por?: string
          etapa_id?: string | null
          funil_id?: string
          id?: string
          pode_mover?: boolean | null
          pode_ver?: boolean | null
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permissoes_colaborador_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permissoes_colaborador_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "etapas_funil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permissoes_colaborador_funil_id_fkey"
            columns: ["funil_id"]
            isOneToOne: false
            referencedRelation: "funis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permissoes_colaborador_usuario_id_fkey"
            columns: ["usuario_id"]
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
      respostas_lead: {
        Row: {
          created_at: string
          id: string
          negociacao_id: string
          pergunta_id: string
          resposta_opcao: string | null
          resposta_texto: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          negociacao_id: string
          pergunta_id: string
          resposta_opcao?: string | null
          resposta_texto?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          negociacao_id?: string
          pergunta_id?: string
          resposta_opcao?: string | null
          resposta_texto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "respostas_lead_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "funil_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respostas_lead_negociacao_id_fkey"
            columns: ["negociacao_id"]
            isOneToOne: false
            referencedRelation: "negociacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respostas_lead_pergunta_id_fkey"
            columns: ["pergunta_id"]
            isOneToOne: false
            referencedRelation: "perguntas"
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
      whatsapp_conexoes: {
        Row: {
          conectado_em: string | null
          created_at: string
          funil_id: string
          id: string
          numero: string | null
          responsavel_padrao_id: string
          status: Database["public"]["Enums"]["status_conexao_whatsapp"]
          updated_at: string
        }
        Insert: {
          conectado_em?: string | null
          created_at?: string
          funil_id: string
          id?: string
          numero?: string | null
          responsavel_padrao_id: string
          status?: Database["public"]["Enums"]["status_conexao_whatsapp"]
          updated_at?: string
        }
        Update: {
          conectado_em?: string | null
          created_at?: string
          funil_id?: string
          id?: string
          numero?: string | null
          responsavel_padrao_id?: string
          status?: Database["public"]["Enums"]["status_conexao_whatsapp"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conexoes_funil_id_fkey"
            columns: ["funil_id"]
            isOneToOne: false
            referencedRelation: "funis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conexoes_responsavel_padrao_id_fkey"
            columns: ["responsavel_padrao_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          atribuicao: Json | null
          cliente_empresa: string | null
          cliente_id: string | null
          cliente_nome: string | null
          cliente_telefone: string | null
          data_entrada_etapa: string | null
          etapa_cor: Database["public"]["Enums"]["cor_etapa"] | null
          etapa_id: string | null
          etapa_nome: string | null
          etapa_tipo: Database["public"]["Enums"]["tipo_etapa"] | null
          formulario_id: string | null
          formulario_nome: string | null
          funil_id: string | null
          funil_nome: string | null
          id: string | null
          nicho_cor: Database["public"]["Enums"]["cor_etapa"] | null
          nicho_id: string | null
          nicho_nome: string | null
          origem: Database["public"]["Enums"]["origem_negociacao"] | null
          owner_id: string | null
          posicao: number | null
          proxima_acao_data: string | null
          proxima_acao_titulo: string | null
          responsavel_nome: string | null
          servico_ids: string[] | null
          temperatura:
            | Database["public"]["Enums"]["temperatura_negociacao"]
            | null
          ultima_atividade_data: string | null
          ultima_atividade_descricao: string | null
          ultima_atividade_tipo:
            | Database["public"]["Enums"]["tipo_atividade"]
            | null
          valor_estimado: number | null
          valor_vendido: number | null
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
            foreignKeyName: "negociacoes_formulario_id_fkey"
            columns: ["formulario_id"]
            isOneToOne: false
            referencedRelation: "formularios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_funil_id_fkey"
            columns: ["funil_id"]
            isOneToOne: false
            referencedRelation: "funis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "negociacoes_nicho_id_fkey"
            columns: ["nicho_id"]
            isOneToOne: false
            referencedRelation: "nichos"
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
      mensagens_visiveis: {
        Row: {
          arquivo_duracao_segundos: number | null
          arquivo_mime: string | null
          arquivo_nome: string | null
          arquivo_path: string | null
          arquivo_tamanho: number | null
          autor_id: string | null
          conteudo: string | null
          conversa_id: string | null
          created_at: string | null
          direcao: Database["public"]["Enums"]["direcao_mensagem"] | null
          encaminhada_de_id: string | null
          id: string | null
          resposta_a_conteudo: string | null
          resposta_a_direcao:
            | Database["public"]["Enums"]["direcao_mensagem"]
            | null
          resposta_a_id: string | null
          resposta_a_tipo: Database["public"]["Enums"]["tipo_mensagem"] | null
          status: Database["public"]["Enums"]["status_mensagem"] | null
          tipo: Database["public"]["Enums"]["tipo_mensagem"] | null
          whatsapp_message_id: string | null
        }
        Insert: {
          arquivo_duracao_segundos?: number | null
          arquivo_mime?: string | null
          arquivo_nome?: string | null
          arquivo_path?: string | null
          arquivo_tamanho?: number | null
          autor_id?: string | null
          conteudo?: string | null
          conversa_id?: string | null
          created_at?: string | null
          direcao?: Database["public"]["Enums"]["direcao_mensagem"] | null
          encaminhada_de_id?: string | null
          id?: string | null
          resposta_a_conteudo?: string | null
          resposta_a_direcao?:
            | Database["public"]["Enums"]["direcao_mensagem"]
            | null
          resposta_a_id?: string | null
          resposta_a_tipo?: Database["public"]["Enums"]["tipo_mensagem"] | null
          status?: Database["public"]["Enums"]["status_mensagem"] | null
          tipo?: Database["public"]["Enums"]["tipo_mensagem"] | null
          whatsapp_message_id?: string | null
        }
        Update: {
          arquivo_duracao_segundos?: number | null
          arquivo_mime?: string | null
          arquivo_nome?: string | null
          arquivo_path?: string | null
          arquivo_tamanho?: number | null
          autor_id?: string | null
          conteudo?: string | null
          conversa_id?: string | null
          created_at?: string | null
          direcao?: Database["public"]["Enums"]["direcao_mensagem"] | null
          encaminhada_de_id?: string | null
          id?: string | null
          resposta_a_conteudo?: string | null
          resposta_a_direcao?:
            | Database["public"]["Enums"]["direcao_mensagem"]
            | null
          resposta_a_id?: string | null
          resposta_a_tipo?: Database["public"]["Enums"]["tipo_mensagem"] | null
          status?: Database["public"]["Enums"]["status_mensagem"] | null
          tipo?: Database["public"]["Enums"]["tipo_mensagem"] | null
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_encaminhada_de_id_fkey"
            columns: ["encaminhada_de_id"]
            isOneToOne: false
            referencedRelation: "mensagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_encaminhada_de_id_fkey"
            columns: ["encaminhada_de_id"]
            isOneToOne: false
            referencedRelation: "mensagens_visiveis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_resposta_a_id_fkey"
            columns: ["resposta_a_id"]
            isOneToOne: false
            referencedRelation: "mensagens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_resposta_a_id_fkey"
            columns: ["resposta_a_id"]
            isOneToOne: false
            referencedRelation: "mensagens_visiveis"
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
      atualizar_cliente_do_card: {
        Args: {
          p_cargo: string
          p_cliente_id: string
          p_cnpj: string
          p_cpf: string
          p_email: string
          p_empresa: string
          p_instagram: string
          p_negociacao_id: string
          p_nome: string
          p_observacoes: string
          p_responsavel: string
          p_telefone: string
          p_tipo_cliente: Database["public"]["Enums"]["tipo_cliente"]
          p_whatsapp: string
        }
        Returns: undefined
      }
      atualizar_dados_operacionais_negociacao: {
        Args: {
          p_data_primeira_reuniao: string
          p_data_proposta: string
          p_forma_pagamento: Database["public"]["Enums"]["forma_pagamento"]
          p_negociacao_id: string
          p_nicho_id: string
          p_objecao_principal: string
          p_temperatura: Database["public"]["Enums"]["temperatura_negociacao"]
          p_valor_estimado: number
          p_valor_proposta: number
        }
        Returns: undefined
      }
      atualizar_fechamento: {
        Args: {
          p_contrato_assinado: boolean
          p_contrato_enviado: boolean
          p_data_fechamento: string
          p_link_contrato?: string
          p_negociacao_id: string
          p_observacoes?: string
          p_servico_ids?: string[]
          p_status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          p_status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          p_tipo_venda?: Database["public"]["Enums"]["tipo_venda"]
          p_valor_vendido: number
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
          p_funil_id?: string
          p_instagram?: string
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
      criar_cliente_whatsapp: {
        Args: { p_conversa_id: string; p_nome: string; p_telefone: string }
        Returns: {
          cliente_id: string
          negociacao_id: string
        }[]
      }
      criar_funil: {
        Args: {
          p_etapa_ganha_cor: Database["public"]["Enums"]["cor_etapa"]
          p_etapa_ganha_nome: string
          p_etapa_perdida_cor: Database["public"]["Enums"]["cor_etapa"]
          p_etapa_perdida_nome: string
          p_etapas_abertas?: Json
          p_nome: string
        }
        Returns: string
      }
      criar_negociacao: {
        Args: {
          p_cliente_id: string
          p_funil_id: string
          p_origem?: Database["public"]["Enums"]["origem_negociacao"]
          p_temperatura?: Database["public"]["Enums"]["temperatura_negociacao"]
          p_valor_estimado?: number
        }
        Returns: string
      }
      criar_ou_reaproveitar_cliente: {
        Args: {
          p_cargo?: string
          p_cnpj?: string
          p_cpf?: string
          p_email?: string
          p_empresa?: string
          p_funil_id?: string
          p_instagram?: string
          p_nome: string
          p_observacoes?: string
          p_owner_id?: string
          p_responsavel?: string
          p_telefone?: string
          p_tipo_cliente: Database["public"]["Enums"]["tipo_cliente"]
          p_whatsapp?: string
        }
        Returns: {
          cliente_id: string
          negociacao_id: string
          reaproveitado: boolean
        }[]
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
          em_recuperacao_qtd: number
          em_recuperacao_valor: number
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
      definir_etapa_inicial: {
        Args: { p_etapa_id: string }
        Returns: undefined
      }
      desqualificar_negociacao: {
        Args: { p_motivo: string; p_negociacao_id: string }
        Returns: undefined
      }
      duplicar_funil: {
        Args: { p_funil_id: string; p_novo_nome: string }
        Returns: string
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
          p_observacoes?: string
          p_posicao: number
          p_servico_ids?: string[]
          p_status_onboarding: Database["public"]["Enums"]["status_onboarding"]
          p_status_pagamento: Database["public"]["Enums"]["status_pagamento"]
          p_tipo_venda?: Database["public"]["Enums"]["tipo_venda"]
          p_valor_vendido: number
        }
        Returns: undefined
      }
      funil_metricas: {
        Args: { p_fim: string; p_funil_id: string; p_inicio: string }
        Returns: {
          alcancaram: number
          cor: Database["public"]["Enums"]["cor_etapa"]
          etapa_id: string
          nome: string
          ordem: number
          parados_7_dias: number
          parados_medio_segundos: number
          permanencias: number
          pos_fechamento: boolean
          quantidade: number
          tempo_medio_segundos: number
          tipo: Database["public"]["Enums"]["tipo_etapa"]
          total_entraram: number
          valor: number
        }[]
      }
      funis_uso: {
        Args: never
        Returns: {
          funil_id: string
          negociacoes_atuais: number
        }[]
      }
      ingerir_lead_formulario: {
        Args: {
          p_atribuicao?: Json
          p_email?: string
          p_empresa?: string
          p_external_id: string
          p_formulario_slug: string
          p_instagram?: string
          p_nicho_slug: string
          p_nome: string
          p_respostas?: Json
          p_telefone?: string
        }
        Returns: {
          cliente_id: string
          criado: boolean
          negociacao_id: string
        }[]
      }
      is_gerente: { Args: never; Returns: boolean }
      metas_progresso: {
        Args: { p_mes: string }
        Returns: {
          ativo: boolean
          meta_id_mrr: string
          meta_id_tcv: string
          nome: string
          realizado_mrr: number
          realizado_tcv: number
          role: Database["public"]["Enums"]["user_role"]
          usuario_id: string
          valor_meta_mrr: number
          valor_meta_tcv: number
        }[]
      }
      mover_negociacao: {
        Args: { p_etapa_id: string; p_negociacao_id: string; p_posicao: number }
        Returns: undefined
      }
      negociacao_owner: { Args: { p_negociacao_id: string }; Returns: string }
      nomes_de_usuarios: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          nome: string
        }[]
      }
      pode_mover_etapa: {
        Args: { p_etapa_id: string; p_funil_id: string }
        Returns: boolean
      }
      pode_ver_etapa: {
        Args: { p_etapa_id: string; p_funil_id: string }
        Returns: boolean
      }
      realizado_periodo: {
        Args: { p_fim: string; p_inicio: string }
        Returns: {
          ativo: boolean
          nome: string
          realizado_mrr: number
          realizado_tcv: number
          role: Database["public"]["Enums"]["user_role"]
          usuario_id: string
        }[]
      }
      salvar_ficha_negociacao: {
        Args: {
          p_cargo: string
          p_cliente_id: string
          p_cnpj: string
          p_cpf: string
          p_data_primeira_reuniao: string
          p_data_proposta: string
          p_email: string
          p_empresa: string
          p_forma_pagamento: Database["public"]["Enums"]["forma_pagamento"]
          p_instagram: string
          p_negociacao_id: string
          p_nicho_id: string
          p_nome: string
          p_objecao_principal: string
          p_observacoes: string
          p_responsavel: string
          p_telefone: string
          p_temperatura: Database["public"]["Enums"]["temperatura_negociacao"]
          p_tipo_cliente: Database["public"]["Enums"]["tipo_cliente"]
          p_valor_estimado: number
          p_valor_proposta: number
          p_whatsapp: string
        }
        Returns: undefined
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
      salvar_permissoes_colaborador: {
        Args: { p_permissoes: Json; p_usuario_id: string }
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
      direcao_mensagem: "entrada" | "saida"
      forma_pagamento: "avista" | "boleto_3x" | "cartao_12x"
      frequencia_recorrencia: "diaria" | "semanal" | "mensal"
      origem_evento: "crm" | "google"
      origem_negociacao: "whatsapp" | "formulario" | "manual"
      status_conexao_whatsapp: "desconectado" | "conectando" | "conectado"
      status_evento:
        | "agendado"
        | "confirmado"
        | "realizado"
        | "nao_compareceu"
        | "cancelado"
      status_mensagem: "pendente" | "enviando" | "enviado" | "falhou"
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
      tipo_mensagem: "texto" | "imagem" | "documento" | "audio" | "video"
      tipo_pergunta: "texto_livre" | "escolha_unica" | "escolha_multipla"
      tipo_venda: "tcv" | "mrr"
      user_role: "gerente" | "closer" | "sdr"
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
      direcao_mensagem: ["entrada", "saida"],
      forma_pagamento: ["avista", "boleto_3x", "cartao_12x"],
      frequencia_recorrencia: ["diaria", "semanal", "mensal"],
      origem_evento: ["crm", "google"],
      origem_negociacao: ["whatsapp", "formulario", "manual"],
      status_conexao_whatsapp: ["desconectado", "conectando", "conectado"],
      status_evento: [
        "agendado",
        "confirmado",
        "realizado",
        "nao_compareceu",
        "cancelado",
      ],
      status_mensagem: ["pendente", "enviando", "enviado", "falhou"],
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
      tipo_mensagem: ["texto", "imagem", "documento", "audio", "video"],
      tipo_pergunta: ["texto_livre", "escolha_unica", "escolha_multipla"],
      tipo_venda: ["tcv", "mrr"],
      user_role: ["gerente", "closer", "sdr"],
    },
  },
} as const
