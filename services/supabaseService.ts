/**
 * Supabase Service Layer??????
 * ????????????? Supabase Auth
 * ???? wc_ ???Writing Coach?
 */

import { supabase } from './supabaseClient'
import type {
  ScaffoldContent,
  EssayGradeResult,
  DrillMode,
  HistoryItem,
  VocabularyItem,
  AggregatedError,
} from '../types'

// ???????? localStorage ???
let currentUserId: string | null = null

/**
 * ??????ID???????
 */
export const setCurrentUserId = (userId: string) => {
  currentUserId = userId
  localStorage.setItem('supabase_user_id', userId)
}

/**
 * ??????ID
 */
export const getCurrentUserId = (): string | null => {
  if (!currentUserId) {
    currentUserId = localStorage.getItem('supabase_user_id')
  }
  return currentUserId
}

/**
 * ??????
 */
export const clearCurrentUser = () => {
  currentUserId = null
  localStorage.removeItem('supabase_user_id')
}

// ==========================================
// 1. SCAFFOLD HISTORY (??????)
// ==========================================

/**
 * ????????
 */
export const saveScaffoldHistory = async (
  topic: string,
  scaffoldData: ScaffoldContent,
  draft?: string
) => {
  const userId = getCurrentUserId()
  if (!userId) throw new Error('User not authenticated')

  const { data, error } = await supabase
    .from('wc_scaffold_history')
    .insert({
      user_id: userId,
      topic,
      selected_dimension: scaffoldData.selectedDimension,
      user_idea: scaffoldData.userIdea,
      vocabulary: scaffoldData.vocabulary,
      collocations: scaffoldData.collocations,
      frames: scaffoldData.frames,
      draft: draft || null,
    })
    .select()
    .single()

  if (error) {
    console.error('??????????:', error)
    throw error
  }

  return data
}

/**
 * ???????????
 */
export const getScaffoldHistory = async (limit: number = 50) => {
  const userId = getCurrentUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from('wc_scaffold_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('??????????:', error)
    return []
  }

  return data
}

// ==========================================
// 2. ESSAY GRADES (??????)
// ==========================================

/**
 * ????????
 */
export const saveEssayGrade = async (
  topic: string,
  essay: string,
  result: EssayGradeResult
) => {
  const userId = getCurrentUserId()
  if (!userId) throw new Error('User not authenticated')

  const { data, error } = await supabase
    .from('wc_essay_grades')
    .insert({
      user_id: userId,
      topic,
      essay,
      total_score: result.totalScore,
      content_score: result.subScores.content,
      organization_score: result.subScores.organization,
      proficiency_score: result.subScores.proficiency,
      clarity_score: result.subScores.clarity,
      general_comment: result.generalComment,
      critiques: result.critiques,
      contrastive_learning: result.contrastiveLearning,
      retraining: result.retraining,
      polished_essay: result.polishedEssay,
    })
    .select()
    .single()

  if (error) {
    console.error('??????????:', error)
    throw error
  }

  return data
}

/**
 * ???????????
 */
export const getEssayGrades = async (limit: number = 50) => {
  const userId = getCurrentUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from('wc_essay_grades')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('??????????:', error)
    return []
  }

  return data
}

// ==========================================
// 3. DRILL HISTORY (??????)
// ==========================================

/**
 * ????????
 */
export const saveDrillHistory = async (
  mode: DrillMode,
  score: number,
  totalQuestions: number,
  drillItems: any[]
) => {
  const userId = getCurrentUserId()
  if (!userId) throw new Error('User not authenticated')

  const { data, error } = await supabase
    .from('wc_drill_history')
    .insert({
      user_id: userId,
      mode,
      score,
      total_questions: totalQuestions,
      drill_items: drillItems,
    })
    .select()
    .single()

  if (error) {
    console.error('??????????:', error)
    throw error
  }

  return data
}

/**
 * ???????????
 */
export const getDrillHistory = async (limit: number = 50) => {
  const userId = getCurrentUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from('wc_drill_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('??????????:', error)
    return []
  }

  return data
}

// ==========================================
// 4. AGENT USAGE LOGS (???????)
// ==========================================

/**
 * ???????
 */
export const logAgentUsage = async (
  agentName: string,
  agentType: 'writing_system' | 'coze_agent' | 'custom',
  sessionDuration?: number,
  actionsCount: number = 1
) => {
  const userId = getCurrentUserId()
  if (!userId) return // ????????

  const { error } = await supabase
    .from('wc_agent_usage_logs')
    .insert({
      user_id: userId,
      agent_name: agentName,
      agent_type: agentType,
      session_duration: sessionDuration || null,
      actions_count: actionsCount,
    })

  if (error) {
    console.error('?????????:', error)
  }
}

// ==========================================
// 5. ????????????
// ==========================================

/**
 * ???????????
 */
export const getAllLearningStats = async () => {
  const userId = getCurrentUserId()
  if (!userId) {
    return {
      totalTrainings: 0,
      totalEssays: 0,
      totalDrills: 0,
    }
  }

  // ????
  const [scaffoldData, essayData, drillData] = await Promise.all([
    supabase
      .from('wc_scaffold_history')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase
      .from('wc_essay_grades')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase
      .from('wc_drill_history')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ])

  return {
    totalTrainings: scaffoldData.count || 0,
    totalEssays: essayData.count || 0,
    totalDrills: drillData.count || 0,
  }
}

/**
 * ?????????????
 */
export const getAggregatedUserVocab = async (limit: number = 15): Promise<VocabularyItem[]> => {
  const userId = getCurrentUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from('wc_scaffold_history')
    .select('vocabulary')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('??????:', error)
    return []
  }

  // ?????
  const vocabMap = new Map<string, VocabularyItem>()
  data.forEach((record) => {
    const vocabList = record.vocabulary as VocabularyItem[]
    vocabList?.forEach((vocab) => {
      if (!vocabMap.has(vocab.word.toLowerCase())) {
        vocabMap.set(vocab.word.toLowerCase(), vocab)
      }
    })
  })

  const allVocab = Array.from(vocabMap.values())
  return allVocab.sort(() => 0.5 - Math.random()).slice(0, limit)
}

/**
 * ?????????????
 */
export const getAggregatedUserCollocations = async (
  limit: number = 20
): Promise<{ en: string; zh: string; topic: string; date: string }[]> => {
  const userId = getCurrentUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from('wc_scaffold_history')
    .select('collocations, topic, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('??????:', error)
    return []
  }

  // ?????
  const collocationMap = new Map<string, { en: string; zh: string; topic: string; date: string }>()
  data.forEach((record) => {
    const collocations = record.collocations as { en: string; zh: string }[]
    collocations?.forEach((col) => {
      if (!collocationMap.has(col.en.toLowerCase())) {
        collocationMap.set(col.en.toLowerCase(), {
          en: col.en,
          zh: col.zh,
          topic: record.topic,
          date: record.created_at,
        })
      }
    })
  })

  const allCollocations = Array.from(collocationMap.values())
  return allCollocations.sort(() => 0.5 - Math.random()).slice(0, limit)
}

/**
 * ?????????????????
 */
export const getAggregatedUserErrors = async (limit: number = 20): Promise<AggregatedError[]> => {
  const userId = getCurrentUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from('wc_essay_grades')
    .select('critiques')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10) // ????10???

  if (error) {
    console.error('????????:', error)
    return []
  }

  // ??????
  const allErrors: AggregatedError[] = []
  data.forEach((record) => {
    const critiques = record.critiques as any[]
    critiques?.forEach((critique) => {
      allErrors.push({
        original: critique.original,
        context: critique.context,
        revised: critique.revised,
        category: critique.category,
        explanation: critique.explanation,
        severity: critique.severity,
      })
    })
  })

  return allErrors.slice(0, limit)
}

// ==========================================
// 6. ??????????? HistoryItem ???
// ==========================================

/**
 * ?????????????????
 * ???????? localStorage ??
 */
export const getHistory = async (): Promise<HistoryItem[]> => {
  const userId = getCurrentUserId()
  if (!userId) return []

  // ????????
  const [scaffoldData, essayData] = await Promise.all([
    supabase
      .from('wc_scaffold_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('wc_essay_grades')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ])

  const historyItems: HistoryItem[] = []

  // ?? scaffold_history
  scaffoldData.data?.forEach((record) => {
    historyItems.push({
      id: record.id,
      timestamp: new Date(record.created_at).getTime(),
      topic: record.topic,
      dataType: 'scaffold',
      data: {
        selectedDimension: record.selected_dimension,
        userIdea: record.user_idea,
        vocabulary: record.vocabulary,
        collocations: record.collocations,
        frames: record.frames,
      },
    })
  })

  // ?? essay_grades
  essayData.data?.forEach((record) => {
    historyItems.push({
      id: record.id,
      timestamp: new Date(record.created_at).getTime(),
      topic: record.topic,
      dataType: 'essay_grade',
      data: {
        essay: record.essay,
        result: {
          totalScore: record.total_score,
          subScores: {
            content: record.content_score,
            organization: record.organization_score,
            proficiency: record.proficiency_score,
            clarity: record.clarity_score,
          },
          generalComment: record.general_comment,
          issueOverview: { critical: [], general: [], minor: [] }, // ?????
          critiques: record.critiques,
          contrastiveLearning: record.contrastive_learning,
          retraining: record.retraining,
          polishedEssay: record.polished_essay,
        },
      },
    })
  })

  // ???????
  historyItems.sort((a, b) => b.timestamp - a.timestamp)

  return historyItems
}
