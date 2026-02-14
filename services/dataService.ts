/**
 * 统一数据服务层
 * 优先使用 Supabase，失败时降级到 localStorage
 * 用于平滑迁移
 */

import * as SupabaseService from './supabaseService'
import * as LocalStorageService from './storageService'
import type {
  HistoryItem,
  ScaffoldContent,
  EssayHistoryData,
  HistoryDataType,
  VocabularyItem,
  AggregatedError,
} from '../types'

// 配置开关：是否启用 Supabase
const USE_SUPABASE = true

// ==========================================
// 保存到历史
// ==========================================

export const saveToHistory = async (
  topic: string,
  data: ScaffoldContent | EssayHistoryData,
  dataType: HistoryDataType
): Promise<HistoryItem> => {
  if (USE_SUPABASE) {
    try {
      if (dataType === 'scaffold') {
        const record = await SupabaseService.saveScaffoldHistory(topic, data as ScaffoldContent)
        return {
          id: record.id,
          timestamp: new Date(record.created_at).getTime(),
          topic,
          dataType,
          data,
        }
      } else if (dataType === 'essay_grade') {
        const essayData = data as EssayHistoryData
        const record = await SupabaseService.saveEssayGrade(topic, essayData.essay, essayData.result)
        return {
          id: record.id,
          timestamp: new Date(record.created_at).getTime(),
          topic,
          dataType,
          data,
        }
      }
    } catch (error) {
      console.error('Supabase 保存失败，降级到 localStorage:', error)
    }
  }

  // 降级到 localStorage
  return LocalStorageService.saveToHistory(topic, data, dataType)
}

// ==========================================
// 获取历史记录
// ==========================================

export const getHistory = async (typeFilter?: HistoryDataType): Promise<HistoryItem[]> => {
  if (USE_SUPABASE) {
    try {
      const history = await SupabaseService.getHistory()
      if (typeFilter) {
        return history.filter(item => item.dataType === typeFilter)
      }
      return history
    } catch (error) {
      console.error('Supabase 获取失败，降级到 localStorage:', error)
    }
  }

  // 降级到 localStorage
  return LocalStorageService.getHistory(typeFilter)
}

// ==========================================
// 学习统计
// ==========================================

export interface LearningStats {
  totalTrainings: number
  totalEssays: number
  totalDrills: number
}

export const getAllLearningStats = async (): Promise<LearningStats> => {
  if (USE_SUPABASE) {
    try {
      return await SupabaseService.getAllLearningStats()
    } catch (error) {
      console.error('Supabase 统计失败，降级到 localStorage:', error)
    }
  }

  // 降级到 localStorage
  return LocalStorageService.getAllLearningStats()
}

// ==========================================
// 聚合查询
// ==========================================

export const getAggregatedUserVocab = async (limit: number = 15): Promise<VocabularyItem[]> => {
  if (USE_SUPABASE) {
    try {
      return await SupabaseService.getAggregatedUserVocab(limit)
    } catch (error) {
      console.error('Supabase 词汇查询失败，降级到 localStorage:', error)
    }
  }

  return LocalStorageService.getAggregatedUserVocab(limit)
}

export const getAggregatedUserCollocations = async (
  limit: number = 20
): Promise<{ en: string; zh: string; topic: string; date: string }[]> => {
  if (USE_SUPABASE) {
    try {
      return await SupabaseService.getAggregatedUserCollocations(limit)
    } catch (error) {
      console.error('Supabase 搭配查询失败，降级到 localStorage:', error)
    }
  }

  return LocalStorageService.getAggregatedUserCollocations(limit)
}

export const getAggregatedUserErrors = async (limit: number = 20): Promise<AggregatedError[]> => {
  if (USE_SUPABASE) {
    try {
      return await SupabaseService.getAggregatedUserErrors(limit)
    } catch (error) {
      console.error('Supabase 错误查询失败，降级到 localStorage:', error)
    }
  }

  return LocalStorageService.getAggregatedUserErrors(limit)
}

// ==========================================
// 导出其他函数（直接使用 localStorage）
// ==========================================

export { deleteFromHistory, checkIsSaved } from './storageService'
