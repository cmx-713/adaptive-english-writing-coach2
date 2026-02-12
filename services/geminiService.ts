import { GoogleGenAI, Type, Schema } from "@google/genai";
import { 
  InspirationCard, 
  ScaffoldContent, 
  VocabularyItem, 
  CollocationItem, 
  DraftFeedback,
  EssayGradeResult,
  DrillItem,
  DrillMode,
  AdaptiveContext,
  ApiConfig,
  ContrastivePoint
} from "../types";

// Define the IdeaValidationResult type locally and export it as it is used by components
export interface IdeaValidationResult {
  status: 'exceptional' | 'valid' | 'weak' | 'off_topic';
  feedbackTitle: string;
  analysis: string;
  thinkingExpansion: string[]; // Layer 2: 基于用户观点的个性化思路拓展（中文）
}

// 将 Google Type schema 转为简化 JSON 示例字符串，帮助非 Google 模型理解输出结构
const schemaToJsonExample = (schema: Schema, depth: number = 0): string => {
  try {
    const indent = '  '.repeat(depth);
    const innerIndent = '  '.repeat(depth + 1);
    
    if (schema.type === Type.STRING) {
      const desc = (schema as any).description ? ` // ${(schema as any).description}` : '';
      const enumVals = (schema as any).enum;
      if (enumVals) return `"one of: ${enumVals.join(' | ')}"${desc}`;
      return `"string"${desc}`;
    }
    if (schema.type === Type.NUMBER) {
      const desc = (schema as any).description ? ` // ${(schema as any).description}` : '';
      return `0${desc}`;
    }
    if (schema.type === Type.BOOLEAN) return 'false';
    if (schema.type === Type.ARRAY) {
      const items = (schema as any).items;
      if (items) {
        const itemExample = schemaToJsonExample(items, depth + 1);
        return `[\n${innerIndent}${itemExample}\n${indent}]`;
      }
      return '[]';
    }
    if (schema.type === Type.OBJECT) {
      const props = (schema as any).properties;
      if (!props) return '{}';
      const entries = Object.entries(props).map(([key, val]) => {
        const valStr = schemaToJsonExample(val as Schema, depth + 1);
        return `${innerIndent}"${key}": ${valStr}`;
      });
      return `{\n${entries.join(',\n')}\n${indent}}`;
    }
    return '"unknown"';
  } catch {
    return '{}';
  }
};

// 安全的 JSON 解析：如果失败，提供清晰的错误信息
const safeJsonParse = (json: string, context: string = 'API'): any => {
  try {
    return JSON.parse(json);
  } catch (e) {
    console.error(`[${context}] JSON parse failed. Raw (first 500 chars):`, json.substring(0, 500));
    throw new Error(`AI 返回的数据格式异常（${context}），请重试。如果使用自定义 API，请确认模型支持 JSON 输出格式。`);
  }
};

const getFullApiConfig = (): ApiConfig => {
  const stored = localStorage.getItem('cet_api_config');
  if (stored) {
    try {
      const config = JSON.parse(stored) as ApiConfig;
      if (config.apiKey) return config;
    } catch (e) { console.error("Invalid config", e); }
  }
  return { 
    provider: 'google', 
    apiKey: process.env.API_KEY || '', 
    modelName: 'gemini-3-flash-preview' 
  };
};

// 向后兼容：部分代码仍使用此函数
const getApiConfig = (): { apiKey: string, model: string } => {
  const config = getFullApiConfig();
  return { apiKey: config.apiKey, model: config.modelName || 'gemini-3-flash-preview' };
};

const getClient = () => {
  const { apiKey } = getApiConfig();
  if (!apiKey) throw new Error("API Key missing. Please check your settings.");
  return new GoogleGenAI({ apiKey });
};

// OpenAI 兼容接口调用（DeepSeek、Moonshot、Qwen、GLM、OpenAI、Custom）
const callOpenAICompatible = async (
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  options: { temperature?: number; jsonMode?: boolean; seed?: number } = {}
): Promise<string> => {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  
  const body: any = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: options.temperature !== undefined ? options.temperature : 0.7,
    top_p: 0.95,
    max_tokens: 8192, // 防止复杂响应被截断（DeepSeek 默认仅 4096）
  };

  // 添加 seed 以提高评分确定性
  if (options.seed !== undefined) {
    body.seed = options.seed;
  }

  // JSON 模式：大部分 OpenAI 兼容 API 都支持
  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  
  // 检测输出是否被截断
  const finishReason = data.choices?.[0]?.finish_reason;
  if (finishReason === 'length') {
    console.warn('[callOpenAICompatible] Response truncated (finish_reason=length). Output may be incomplete.');
  }
  
  const content = data.choices?.[0]?.message?.content || "";
  
  if (!content) {
    console.error('[callOpenAICompatible] Empty content. Full response:', JSON.stringify(data).substring(0, 500));
    throw new Error('AI 返回了空内容。请检查 API Key 和模型名称是否正确。');
  }
  
  return cleanJsonResponse(content);
};

// 清理 AI 返回的 JSON：去除 markdown 代码块、前后多余文本、修复截断
const cleanJsonResponse = (text: string): string => {
  let cleaned = text.trim();
  
  // 去除 markdown 代码块: ```json ... ``` 或 ``` ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }
  
  // 如果开头不是 { 或 [，尝试找到第一个 JSON 起始位置
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const jsonStart = cleaned.search(/[\[{]/);
    if (jsonStart !== -1) {
      cleaned = cleaned.substring(jsonStart);
    }
  }
  
  // 如果结尾不是 } 或 ]，截断到最后一个完整闭合处
  if (!cleaned.endsWith('}') && !cleaned.endsWith(']')) {
    const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (lastBrace !== -1) {
      cleaned = cleaned.substring(0, lastBrace + 1);
    }
  }
  
  // 尝试修复被截断的 JSON（补全未闭合的括号）
  try {
    JSON.parse(cleaned);
    return cleaned; // 已经是合法 JSON，直接返回
  } catch {
    // JSON 不合法，尝试补全
    return tryRepairTruncatedJson(cleaned);
  }
};

// 尝试修复被截断的 JSON：关闭未闭合的字符串、数组、对象
const tryRepairTruncatedJson = (text: string): string => {
  let repaired = text;
  
  // 1. 如果截断在字符串中间（奇数个未转义引号），关闭字符串
  let inString = false;
  let lastCharBeforeEnd = '';
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (ch === '"' && lastCharBeforeEnd !== '\\') {
      inString = !inString;
    }
    lastCharBeforeEnd = ch;
  }
  if (inString) {
    repaired += '"';
  }
  
  // 2. 去掉尾部不完整的 key-value（如 "key": 或 "key":  "val 截断）
  //    找到最后一个完整的 value 结束位置
  repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*("[^"]*)?$/s, '');
  repaired = repaired.replace(/,\s*$/s, '');
  
  // 3. 补全未闭合的 [] 和 {}
  const stack: string[] = [];
  let inStr = false;
  let escape = false;
  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inStr) { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
    }
  }
  
  // 按倒序关闭未闭合的括号
  while (stack.length > 0) {
    repaired += stack.pop();
  }
  
  return repaired;
};

const callAI = async(
  systemPrompt: string, 
  userPrompt: string, 
  responseSchema?: Schema,
  options: { temperature?: number; seed?: number } = {}
  ):Promise<string> => {
  const fullConfig = getFullApiConfig();
  const isGoogle = fullConfig.provider === 'google';

  // 非 Google 提供商：使用 OpenAI 兼容接口
  if (!isGoogle && fullConfig.baseUrl) {
    // 如果有 JSON schema 要求，在 prompt 中追加 JSON 格式说明 + Schema 结构
    let enhancedSystemPrompt = systemPrompt;
    if (responseSchema) {
      const schemaDesc = schemaToJsonExample(responseSchema);
      enhancedSystemPrompt += `\n\nIMPORTANT: You MUST respond with valid JSON only. No extra text, no markdown code fences, just pure JSON.\n\nRequired JSON structure:\n${schemaDesc}`;
    }
    
    return callOpenAICompatible(
      fullConfig.baseUrl,
      fullConfig.apiKey,
      fullConfig.modelName,
      enhancedSystemPrompt,
      userPrompt,
      { 
        temperature: options.temperature, 
        jsonMode: !!responseSchema,
        seed: options.seed
      }
    );
  }

  // Google 提供商：使用原生 SDK（支持 structured output / JSON schema）
  const ai = getClient();
  const config: any = {
    temperature: options.temperature !== undefined ? options.temperature : 0.7,
    topK: 40,
    topP: 0.95,
  };

  if (responseSchema) {
    config.responseMimeType = "application/json";
    config.responseSchema = responseSchema;
  }

  const response = await ai.models.generateContent({
    model: fullConfig.modelName || 'gemini-3-flash-preview',
    config,
    contents: [
      { role: 'user', parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }
    ]
  });

  const text = response.text || "";
  return responseSchema ? cleanJsonResponse(text) : text;
};

// --- Module 1: Socratic Coach Functions ---

export const fetchInspirationCards = async (topic: string): Promise<InspirationCard[]> => {
  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        dimension: { type: Type.STRING },
        socraticQuestion: { type: Type.STRING },
        hint: { type: Type.STRING },
        keywords: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              en: { type: Type.STRING },
              zh: { type: Type.STRING }
            },
            required: ['en', 'zh']
          }
        },
        thinkingExpansion: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "3-4 concrete thinking angles in Chinese for this dimension"
        }
      },
      required: ['id', 'dimension', 'socraticQuestion', 'hint', 'keywords', 'thinkingExpansion']
    }
  };

  const systemPrompt = "You are a CET-4/6 writing coach. Help Chinese students brainstorm. You MUST write the socraticQuestion, hint, and thinkingExpansion fields in Chinese (中文), so that students can easily understand. The dimension field should remain in English.";
  const userPrompt = `Generate 3 distinct inspiration cards for the essay topic: "${topic}". Each card should represent a different perspective (e.g., Economic, Social, Personal). 

IMPORTANT:
- The "socraticQuestion" and "hint" fields MUST be written in Chinese (中文) to help students understand.
- The "thinkingExpansion" field MUST be an array of 3-4 strings in Chinese (中文). Each string is a concrete thinking angle or argument point for this dimension. These help students who have shallow initial ideas by giving them specific sub-points to develop.

Example for topic "科技对教育的影响" with dimension "Economic":
"thinkingExpansion": [
  "在线教育平台降低了学习成本，让偏远地区学生也能获得优质资源",
  "教育科技产业本身创造了大量就业岗位和经济价值",
  "技术培训提升了劳动力素质，间接推动经济增长",
  "数字鸿沟可能加剧教育不平等，影响社会经济流动性"
]

Each point should be a complete、specific argument (not vague), 15-30 Chinese characters, helping students think deeper about this dimension.`;
  
  const res = await callAI(systemPrompt, userPrompt, schema);
  return safeJsonParse(res, 'fetchInspirationCards');
};

export const validateIdea = async (topic: string, dimension: string, idea: string): Promise<IdeaValidationResult> => {
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      status: { type: Type.STRING, enum: ['exceptional', 'valid', 'weak', 'off_topic'] },
      feedbackTitle: { type: Type.STRING },
      analysis: { type: Type.STRING },
      thinkingExpansion: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "3-4 personalized thinking angles based on the student's specific idea, in Chinese"
      }
    },
    required: ['status', 'feedbackTitle', 'analysis', 'thinkingExpansion']
  };

  const systemPrompt = "You are a strict but helpful writing coach. Evaluate the student's idea relevance. You MUST write the feedbackTitle, analysis, and thinkingExpansion fields in Chinese (中文), so that students can easily understand your feedback.";
  const userPrompt = `Topic: ${topic}\nDimension: ${dimension}\nStudent Idea: ${idea}\nProvide feedback. IMPORTANT: The "feedbackTitle" and "analysis" fields MUST be written in Chinese (中文).

CRITICAL: You must also generate "thinkingExpansion" — an array of 3-4 strings in Chinese (中文). These are PERSONALIZED thinking angles that help the student DEEPEN their specific idea. 

Rules for thinkingExpansion:
- Read the student's idea carefully. Identify the core angle they chose.
- Generate 3-4 sub-points that EXTEND and DEEPEN that specific angle (not generic dimension-level points).
- Each point should be a concrete, specific argument (15-30 Chinese characters).
- If the student's idea is about "数据泄露对企业的影响", the expansion should be about SPECIFIC types of enterprise impact (direct losses, legal penalties, reputation damage), NOT about general economic angles.
- If the student's idea is weak or off-topic, provide angles that could help them find a better direction within this dimension.

Example: 
Student Idea: "数据泄露会对企业造成巨大经济损失"
Good thinkingExpansion: [
  "直接损失：数据恢复成本、系统停机期间的营收损失",
  "法律风险：违反GDPR等数据保护法规可能面临巨额罚款",
  "品牌信任危机：客户流失导致长期收入下降",
  "连锁反应：投资者信心动摇，股价下跌，融资困难"
]
Bad thinkingExpansion (too generic): [
  "信息安全产业创造就业机会",
  "网络安全投入保障基础设施"
]`;
  
  const res = await callAI(systemPrompt, userPrompt, schema);
  return safeJsonParse(res, 'validateIdea');
};

export const fetchLanguageScaffolds = async (topic: string, dimension: string, userIdea: string): Promise<ScaffoldContent> => {
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      selectedDimension: { type: Type.STRING },
      userIdea: { type: Type.STRING },
      vocabulary: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            chinese: { type: Type.STRING },
            englishDefinition: { type: Type.STRING },
            usage: { type: Type.STRING }
          },
          required: ['word', 'chinese', 'englishDefinition', 'usage']
        }
      },
      collocations: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            en: { type: Type.STRING },
            zh: { type: Type.STRING }
          },
          required: ['en', 'zh']
        }
      },
      frames: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            patternName: { type: Type.STRING },
            patternNameZh: { type: Type.STRING },
            template: { type: Type.STRING },
            modelSentence: { type: Type.STRING }
          },
          required: ['patternName', 'patternNameZh', 'template', 'modelSentence']
        }
      }
    },
    required: ['selectedDimension', 'userIdea', 'vocabulary', 'collocations', 'frames']
  };

  const systemPrompt = "You are a CET-4/6 writing coach helping Chinese students. Provide vocabulary and sentence frames to help the student expand their idea.";
  const userPrompt = `Topic: ${topic}\nDimension: ${dimension}\nStudent Idea: ${userIdea}\nGenerate scaffolds.\n\nIMPORTANT for the "frames" field: Generate 3 sentence frames. Each frame must include:\n- "patternName": the English sentence pattern name (e.g., "Not only...but also...")\n- "patternNameZh": Chinese translation of the pattern (e.g., "不仅……而且还……")\n- "template": a sentence template where blanks are marked by brackets containing CHINESE hints.\n- "modelSentence": a complete, well-written reference sentence that fills all the blanks perfectly.\n\nCRITICAL RULE for "template": The text inside square brackets [] MUST be in Chinese (中文), NOT English. These hints tell the student what concept to express in each blank.\n\nCORRECT example: "Not only do these activities [培养什么能力], but they also equip students with [什么样的技能] necessary to [达成什么目标]."\nWRONG example: "Not only do these activities [what ability to cultivate], but they also equip students with [what kind of skills] necessary to [what goal to achieve]."\n\nThe hints MUST be short Chinese phrases (2-6 Chinese characters) describing what to fill in.`;
  
  const res = await callAI(systemPrompt, userPrompt, schema);
  return safeJsonParse(res, 'fetchScaffolds');
};

export const fetchDimensionKeywords = async (dimension: string, topic?: string): Promise<{en: string, zh: string}[]> => {
  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        en: { type: Type.STRING },
        zh: { type: Type.STRING }
      },
      required: ['en', 'zh']
    }
  };

  const systemPrompt = "Generate related keywords.";
  const userPrompt = `Dimension: ${dimension}\nTopic: ${topic || 'General'}\nGenerate 8 relevant keywords.`;
  
  const res = await callAI(systemPrompt, userPrompt, schema);
  return safeJsonParse(res, 'fetchDimensionKeywords');
};

export const validateSentence = async (sentence: string, topic: string): Promise<{ isValid: boolean, feedback: string, suggestion: string }> => {
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      isValid: { type: Type.BOOLEAN },
      feedback: { type: Type.STRING },
      suggestion: { type: Type.STRING }
    },
    required: ['isValid', 'feedback', 'suggestion']
  };

  const systemPrompt = "You are a CET-4/6 writing coach helping Chinese students. Evaluate the student's sentence completion. You MUST write feedback and suggestion in Chinese (中文).";
  const userPrompt = `Topic: "${topic}"\nStudent's sentence: "${sentence}"\n\nEvaluate this sentence and provide:\n- "isValid": true if the sentence is grammatically correct and makes sense, false otherwise.\n- "feedback": 用中文给出具体反馈，指出语法是否正确、表达是否地道、内容是否切题。如果有错误，明确指出哪里有问题。(2-3句话)\n- "suggestion": 用中文给出一条改进建议，告诉学生如何让表达更好。如果已经很好，给出一个更高级的替代表达。(1句话)`;
  
  const res = await callAI(systemPrompt, userPrompt, schema);
  return safeJsonParse(res, 'validateSentence');
};

export const fetchMoreCollocations = async (topic: string, dimension: string, userIdea: string): Promise<CollocationItem[]> => {
  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        en: { type: Type.STRING },
        zh: { type: Type.STRING }
      },
      required: ['en', 'zh']
    }
  };
  
  const res = await callAI("Writing assistant", `Generate 6 more advanced collocations for Idea: ${userIdea} (Topic: ${topic})`, schema);
  return safeJsonParse(res, 'fetchMoreCollocations');
};

export const analyzeDraft = async (topic: string, dimension: string, draft: string, vocabulary: VocabularyItem[]): Promise<DraftFeedback> => {
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      score: { type: Type.NUMBER, description: "Score from 0 to 10 (integer). MUST be between 0 and 10." },
      comment: { type: Type.STRING },
      usedVocabulary: { type: Type.ARRAY, items: { type: Type.STRING } },
      suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
      polishedVersion: { type: Type.STRING }
    },
    required: ['score', 'comment', 'suggestions', 'polishedVersion']
  };

  const vocabList = vocabulary.map(v => v.word).join(', ');
  const systemPrompt = "You are a CET-4/6 writing coach helping Chinese students. You MUST write the comment and suggestions fields in Chinese (中文) to help students understand your feedback. The polishedVersion field should remain in English as it is a model English paragraph.";
  const userPrompt = `Topic: ${topic}\nDimension: ${dimension}\nDraft: "${draft}"\nTarget Vocab: ${vocabList}\nAnalyze the draft.\n\nSCORING RULE: The "score" field MUST be an integer from 0 to 10. Do NOT use any other scale (not 100-point, not percentage). Examples: 3, 5, 7, 8.\n\nIMPORTANT: The "comment" field MUST be in Chinese (中文), giving specific feedback on grammar, content, and vocabulary usage. The "suggestions" array MUST contain Chinese suggestions (中文建议) telling the student how to improve. The "polishedVersion" should be a polished English paragraph.`;
  
  const res = await callAI(systemPrompt, userPrompt, schema);
  return safeJsonParse(res, 'analyzeDraft');
};

// --- Essay Assembly: Generate Introduction and Conclusion ---

export const generateEssayIntroConclusion = async (
  topic: string, 
  bodyParagraphs: { dimension: string; draft: string }[]
): Promise<{ introduction: string; conclusion: string }> => {
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      introduction: { type: Type.STRING },
      conclusion: { type: Type.STRING }
    },
    required: ['introduction', 'conclusion']
  };

  const bodyText = bodyParagraphs.map((p, i) => `[Dimension ${i + 1}: ${p.dimension}]\n${p.draft}`).join('\n\n');

  const systemPrompt = "You are a CET-4/6 writing coach. Generate an introduction and conclusion paragraph for a student's essay. Match the language level of the student's body paragraphs - do NOT write at a level far above the student's actual writing. Keep both paragraphs concise (2-3 sentences each).";
  const userPrompt = `Topic: "${topic}"\n\nThe student has written the following body paragraphs:\n\n${bodyText}\n\nGenerate:\n- "introduction": An opening paragraph that introduces the topic and previews the main points. Match the student's writing level.\n- "conclusion": A closing paragraph that summarizes the key arguments and provides a final thought. Match the student's writing level.\n\nBoth paragraphs should be in English, concise, and appropriate for CET-4/6 level.`;

  const res = await callAI(systemPrompt, userPrompt, schema);
  return safeJsonParse(res, 'generateIntroConclusion');
};

// --- Module 2: Essay Grader ---

export const gradeEssay = async (topic: string, essayText: string): Promise<EssayGradeResult> => {
  // ===== Step 1a: 独立评分 (Scoring Only) =====
  // 将评分独立出来，使用 temperature=0 + seed 确保稳定性
  const scoringSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      errorCount: { type: Type.NUMBER, description: "Total language errors found" },
      band: { type: Type.NUMBER, description: "Band center: 14, 11, 8, 5, or 2" },
      bandReason: { type: Type.STRING, description: "定档理由（中文），需包含错误数量分析" },
      totalScore: { type: Type.NUMBER, description: "Final score 1-15" },
      subScores: {
        type: Type.OBJECT,
        properties: {
          content: { type: Type.NUMBER, description: "0-4" },
          organization: { type: Type.NUMBER, description: "0-3" },
          proficiency: { type: Type.NUMBER, description: "0-5" },
          clarity: { type: Type.NUMBER, description: "0-3" }
        },
        required: ['content', 'organization', 'proficiency', 'clarity']
      }
    },
    required: ['errorCount', 'band', 'bandReason', 'totalScore', 'subScores']
  };

  const scoringSystemPrompt = `你是一位资深四六级阅卷专家，拥有10年作文评阅经验。你的评分风格是：严厉、精准、区分度高，绝不趋中，绝不手软。
你的唯一任务是给作文评分。不要生成修改意见、范文或其他任何内容。满分15分。

【核心原则】
1. 先定档，后打分：必须先明确作文属于14/11/8/5/2中的哪一个档次，再给出具体分数。
2. 语言错误是降档第一要素：只要有"较多严重错误"（拼写、主谓一致、动词形态、句子结构），直接锁定8分档及以下，禁止给11分以上。
3. 空洞/偏题/无例证 = 内容分腰斩：仅有观点罗列、零展开、零例证、零解释，内容维度(Content)不得超过2/4。
4. 禁止"结构好就给高分"：结构清晰是8分档的及格线，不是11分档的通行证。

【⚠️ 红线规则（不可违反）】
1. 语言错误 ≥ 3处（含拼写、语法、搭配等严重错误）→ 禁止给11分及以上！
2. 任一观点零展开（仅罗列无解释无例证）→ Content不得超过2/4！
3. 严重偏题 → 直接锁定5分档及以下！
4. 字数严重不足 → 总分不得超过8分！
5. 禁止"结构好就给高分"！

【评分五步强制流程】

===== 第1步：快速定档 =====
通读全文，根据整体印象，先给出初步档次（14/11/8/5/2）及一句话理由。

===== 第2步：语言错误普查 =====
逐句检查，找出所有严重语言错误（拼写、主谓不一致、动词形态、冠词、介词、句子结构、中式英语、搭配不当等），统计 errorCount。
- 如果 errorCount ≥ 3 且初步档次为11分档或更高 → 必须降至8分档或更低。

===== 第3步：内容与论证核查 =====
检查每个观点/论点：
- 是否有具体展开（解释 why / how）？
- 是否有例证或细节支撑？
- 如果观点仅是罗列（如"First... Second... Third..."后无展开），Content 不得超过2/4。

===== 第4步：结构与逻辑检查 =====
- 是否有开头引入、主体段落、结尾总结？
- 段落之间逻辑是否连贯？
- 注意：结构清晰只是8分档的基本要求，不能因为结构好就升档。

===== 第5步：综合打分 =====
结合以上四步，确定最终档次和分数。

【档次锚定标准】

【14分档（13-15分）】
切题精准，语言基本无错（errorCount ≤ 2），观点有层次，有解释有例证，行文流畅，逻辑严密。

【11分档（10-12分）】
切题，观点具体可行，每个观点有简要解释，语言少量错误（errorCount ≤ 2），逻辑基本清晰。

【8分档（7-9分）】
观点正确但零展开或展开不足，结构清晰，语言错误 ≥ 3处，或内容空洞。这是"结构好但内容浅+错误多"的典型档次。

【5分档（4-6分）】
严重偏题，语言崩溃（大量严重错误），逻辑断裂，几乎无有效论证。

【2分档（1-3分）】
思路紊乱，语言支离破碎，大部分句子有严重错误，难以理解。

【子分分配】
将 totalScore 分配到4个维度，总和必须等于 totalScore：
- Content (0-4): 切题程度 + 内容深度 + 论证展开
- Organization (0-3): 结构完整性 + 逻辑连贯
- Proficiency (0-5): 语法正确性 + 词汇丰富度 + 拼写准确性
- Clarity (0-3): 表达清晰度 + 可读性

各档次子分参考：
14分档 → Content 3-4, Organization 3, Proficiency 4-5, Clarity 3
11分档 → Content 3, Organization 2-3, Proficiency 3-4, Clarity 2-3
8分档  → Content 1-2, Organization 2, Proficiency 2-3, Clarity 1-2
5分档  → Content 1, Organization 1, Proficiency 1-2, Clarity 1
2分档  → Content 0-1, Organization 0-1, Proficiency 0-1, Clarity 0-1

===== 最终检查 =====
输出前必须确认：
1. errorCount ≥ 3 时，是否已锁定8分档及以下？
2. 观点零展开时，Content 是否 ≤ 2？
3. Content + Organization + Proficiency + Clarity = totalScore？
4. totalScore 是否在所选档次的3分范围内？

bandReason 用中文输出，需包含：第1步初步定档结果、第2步发现的错误数量、第3步内容展开情况、最终定档理由。`;

  const essayUserPrompt = `Topic: ${topic || 'General Essay'}\nEssay: "${essayText}"`;

  // ===== Critique Schema (PHASE 1: Diagnostic) =====
  const critiqueSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      generalComment: { type: Type.STRING, description: "Comprehensive review in Chinese (Professor tone)." },
      issueOverview: {
        type: Type.OBJECT,
        properties: {
          critical: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of major issues in Chinese" },
          general: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of moderate issues in Chinese" },
          minor: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of minor issues in Chinese" }
        },
        required: ['critical', 'general', 'minor']
      },
      critiques: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            original: { type: Type.STRING, description: "The EXACT English text snippet from the student's essay. Do NOT translate. Do NOT summarize."},
            context: { type: Type.STRING, description: "The FULL sentence containing the error. Essential for display." }, 
            revised: { type: Type.STRING },
            category: { type: Type.STRING, enum: ['Content', 'Organization', 'Proficiency', 'Clarity'] },
            severity: { type: Type.STRING, enum: ['critical', 'general', 'minor'] },
            explanation: { type: Type.STRING, description: "Deep diagnostic explanation in CHINESE." }
          },
          required: ['original', 'context', 'revised', 'category', 'severity', 'explanation']
        }
      }
    },
    required: ['generalComment', 'issueOverview', 'critiques']
  };

  const critiqueSystemPrompt = `You are a distinguished Professor of English Writing (CET-4/6 Authority).

  Your task is to generate detailed critiques for this student essay. Do NOT output any scoring fields.
  Be exhaustive in finding ALL issues across all categories. A low-scoring essay can still receive warm, encouraging feedback in Chinese.

  EXECUTION PROTOCOL:

  PHASE 1: THE DIAGNOSTIC PHASE (Full-Spectrum Critique) - CRITICAL PRIORITY
  You must detect and list issues across ALL FOUR categories. Do NOT only focus on grammar.
  - DATA FIELD RULE: The \`context\` field MUST contain the COMPLETE SENTENCE where the issue occurred.
  - QUANTITY RULE: DO NOT LIMIT TO 3 ITEMS. Be exhaustive across all categories.
  
  MANDATORY COVERAGE — You MUST generate critiques in ALL 4 categories:
  
  [Content] (category: "Content"):
  - Arguments that are too shallow, vague, or unsupported by evidence/examples
  - Points that merely assert without reasoning (e.g., "X is important" without explaining why)
  - Missing depth or originality in the analysis
  - Off-topic or irrelevant content
  
  [Organization] (category: "Organization"):
  - Weak or missing thesis statement in the introduction
  - Paragraphs that lack clear topic sentences
  - Poor logical flow between paragraphs or ideas
  - Conclusion that merely repeats the introduction without synthesis or elevation
  - Over-reliance on formulaic transitions without real logical connection
  
  [Proficiency] (category: "Proficiency"):
  - Subject-Verb Agreement, Articles, Prepositions, Tense errors
  - Spelling errors, Chinglish expressions, Collocation errors
  - Run-on sentences, Sentence fragments, Punctuation errors
  - Repetitive vocabulary or sentence patterns
  
  [Clarity] (category: "Clarity"):
  - Ambiguous phrasing where the intended meaning is unclear
  - Confusing sentence structure that impedes understanding
  - Word choice errors that change the intended meaning
  
  Constraint: If the essay has no issues in a category, you may skip it. But you MUST actively look for issues in ALL 4 categories, not just grammar.

  DATA FORMAT Rules:
  - \`generalComment\`, \`issueOverview\`, and \`critiques.explanation\` MUST be in SIMPLIFIED CHINESE.
`;

  // ===== Polish Prompt (PHASE 2: Contrastive Learning + Polished Essay) =====
  const polishSystemPrompt = `You are a distinguished Professor of English Writing (CET-4/6 Authority).

  Your task is to generate contrastive learning analysis and a polished model essay for this student essay. Do NOT generate critiques or scoring.

  PHASE 2: THE COACHING PHASE (Contrastive Logic)
  You are teaching LOGIC, STRUCTURE, and ACADEMIC TONE. 
  When generating the \`contrastiveLearning\` array, you MUST follow this protocol:

  1. STRATEGIC COVERAGE (Must generate 5-6 points):
  Do NOT just pick random vocabulary words. You must identify specific gaps in the student's logic and map them to the model essay. You must include:
  - Point 0 (Introduction): Compare how the student opens vs. the Model's "Hook + Thesis" strategy.
  - Point 1 & 2 (Body Paragraphs): Focus on "Topic Sentences" (Topic + Controlling Idea) or "Logical Cohesion" (Connectors).
  - Point 3 (Argumentation): Focus on "Evidence/Example" depth vs. student's shallow assertions.
  - Point 4 (Conclusion): Focus on "Elevation/Call to Action" vs. simple repetition.
  - Point 5 (Vocabulary/Tone): Only then, focus on academic lexical resource.

  2. INTERACTIVE ANCHORING (CRITICAL FOR UI):
  - You MUST modify the \`polishedEssay\` text to include highlight tags that match the \`contrastiveLearning\` array index.
  - Syntax: Wrap the EXACT sentence or phrase in the \`polishedEssay\` that corresponds to the strategy with \`<highlight id='N'>...</highlight>\`.
  - Rule: If \`contrastiveLearning[0]\` discusses the Introduction, the best sentence in the Model's introduction MUST be wrapped in \`<highlight id='0'>...</highlight>\`.
  - Constraint: Every item in \`contrastiveLearning\` must have a corresponding \`<highlight>\` tag in \`polishedEssay\`.

  3. DATA FORMAT Rules:
  - \`contrastiveLearning.analysis\` MUST be in SIMPLIFIED CHINESE.
  - \`contrastiveLearning.category\` must be one of: 'Strategic Intent', 'Logical Reasoning', 'Language Foundation'.
  - \`contrastiveLearning.userContent\`: The student's original weak sentence/phrase.
  - \`contrastiveLearning.polishedContent\`: The specific upgraded phrase from the model.
  
  - CRITICAL INSTRUCTION for \`contrastiveLearning.analysis\`:
    - Suppress Simple Vocab Checks: Do NOT just say "Used a better word" or "Replaced A with B".
    - Focus on TONE & AUTHORITY: Explain *why* the change makes the essay sound more Professional, Objective, or Authoritative.
    - Bad Example: "用 'indispensable' 替换了 'important'，词汇更高级。" (Too shallow)
    - Good Example: "原句表达过于口语化且主观。范文通过 'indispensable facet'（不可或缺的面向）这一定性描述，建立了客观的学术权威感 (Academic Authority)，使论证更有分量。"

  Structure Tags for Polished Essay:
  - Mark sections clearly with: [INTRODUCTION], [BODY_PARA_1], [BODY_PARA_2], [CONCLUSION].
`;

  // ===== Polish Schema =====
  const polishSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      modelSubScores: {
        type: Type.OBJECT,
        properties: {
          content: { type: Type.NUMBER },
          organization: { type: Type.NUMBER },
          proficiency: { type: Type.NUMBER },
          clarity: { type: Type.NUMBER }
        },
        required: ['content', 'organization', 'proficiency', 'clarity']
      },
      contrastiveLearning: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING, enum: ['Language Foundation', 'Logical Reasoning', 'Strategic Intent'] },
            userContent: { type: Type.STRING },
            polishedContent: { type: Type.STRING },
            analysis: { type: Type.STRING, description: "Strategic analysis in Chinese" }
          },
          required: ['category', 'userContent', 'polishedContent', 'analysis']
        }
      },
      polishedEssay: { type: Type.STRING }
    },
    required: ['contrastiveLearning', 'polishedEssay']
  };

  // ===== Run Step 1a (Scoring) + Critique + Polish in parallel =====
  const [scoringJson, critiqueJson, polishJson] = await Promise.all([
    callAI(scoringSystemPrompt, essayUserPrompt, scoringSchema, { temperature: 0, seed: 42 }),
    callAI(critiqueSystemPrompt, essayUserPrompt, critiqueSchema, { temperature: 0.1 }),
    callAI(polishSystemPrompt, essayUserPrompt, polishSchema, { temperature: 0.1 }),
  ]);

  // Parse scoring
  let scoringData: any;
  try {
    scoringData = JSON.parse(scoringJson);
  } catch (parseError) {
    console.error('Scoring JSON parse failed. Raw:', scoringJson.substring(0, 500));
    throw new Error('AI 返回的评分数据格式异常，请重试。');
  }
  scoringData.totalScore = typeof scoringData.totalScore === 'number' ? scoringData.totalScore : 0;
  scoringData.subScores = scoringData.subScores || { content: 0, organization: 0, proficiency: 0, clarity: 0 };

  // Parse critique
  let critiqueData: any;
  try {
    critiqueData = JSON.parse(critiqueJson);
  } catch (parseError) {
    console.error('Critique JSON parse failed. Raw:', critiqueJson.substring(0, 500));
    critiqueData = {};
  }
  critiqueData.generalComment = critiqueData.generalComment || '暂无评语';
  critiqueData.issueOverview = critiqueData.issueOverview || { critical: [], general: [], minor: [] };
  critiqueData.critiques = Array.isArray(critiqueData.critiques) ? critiqueData.critiques : [];

  // Parse polish
  let polishData: any;
  try {
    polishData = JSON.parse(polishJson);
  } catch (parseError) {
    console.error('Polish JSON parse failed. Raw:', polishJson.substring(0, 500));
    polishData = {};
  }
  polishData.contrastiveLearning = Array.isArray(polishData.contrastiveLearning) ? polishData.contrastiveLearning : [];
  polishData.polishedEssay = polishData.polishedEssay || essayText;

  // Prepare context for Step 2 (using polishData from parallel call)
  const contrastiveContext = polishData.contrastiveLearning
    .map((c: ContrastivePoint, i: number) => `Point ${i + 1} (${c.category || 'General'}): User wrote "${c.userContent || ''}" -> Polished to "${c.polishedContent || ''}". Analysis: ${c.analysis || ''}`)
    .join('\n');
  const polishedWordsContext = (polishData.polishedEssay || '').substring(0, 1000);

  // 5. CALL STEP 2: Retraining Generation (INTEGRATED LEARNING)
  const step2SystemPrompt = `
      Role: CET-4/6 Writing Coach.
      Task: Generate 'Retraining' exercises to help the student *clone* the expert strategies identified in the previous step.
      
      **Core Principle: Integrated Learning (学练一体化)**
      You must NOT generate generic grammar questions. 
      You MUST look at the [Expert Strategy / 高手决策逻辑] provided in the context below, and create exercises that force the student to apply that specific logic to a *new* context.

      **Strict Language Requirement**:
      - **Instruction (question)**: MUST be in **Chinese**. You must explicitly mention the strategy name being cloned (e.g., "请运用范文中使用的【名词化结构】技巧...").
      - **Hint**: MUST be in **Chinese**. Guide the student on *how* to clone the strategy.
      - **Explanation**: MUST be in **Chinese**. Explain why the reference answer is better based on the strategy.

      **Input Context (From Step 1):**
      ${contrastiveContext}

      **Required Exercise Types (Generate 3 Distinct Exercises):**
      
      1. **[Academic Upgrade]** (Focus on 'Language Foundation'):
         - Scenario: Give a simple/oral sentence (Chinglish).
         - Task: Ask the student to rewrite it using specific academic words/structures found in the model essay.
         - Instruction Format: "请模仿范文中的【(Strategy Name/Key Word)】用法，将以下口语化句子改写得更显学术专业："
      
      2. **[Logic Bridge]** (Focus on 'Logical Reasoning'):
         - Scenario: Give two isolated ideas/sentences.
         - Task: Ask the student to connect them using a specific logical transition or cohesive device found in the model essay.
         - Instruction Format: "请运用范文中的【(Strategy Name)】逻辑连接手法，将以下两个松散的分句整合成一个紧密的逻辑整体："
      
      3. **[Intent Realization]** (Focus on 'Strategic Intent'):
         - Scenario: Describe a specific writing goal (e.g., "You want to concede a point to strengthen your argument").
         - Task: Ask the student to write a sentence achieving this goal using the strategy found in the model.
         - Instruction Format: "请参考范文中的【(Strategy Name)】策略，写一个句子来实现以下特定的写作意图："

      **Output Constraints:**
      - \`question\`: The specific instruction in CHINESE following the formats above.
      - \`originalContext\`: The "bad" example, simple sentence, or context description to be improved.
      - \`hint\`: A specific "Expert Tip" pointing back to the model esay's technique (in CHINESE).
      - \`mandatoryKeywords\`: List of 2-3 English keywords/phrases thast strictly force the use of the strategy (e.g., ["Admittedly", "However"]).
      - \`referenceAnswer\`: A perfect C1-level answer (English).
      - \`explanation\`: Explain *why* this answer is better (e.g., "通过使用此技巧，你成功避免了...，提升了...") (in CHINESE).
      - \`materials\`: Extract 3-5 key phrases/words from the provided *polished essay context*: "${polishedWordsContext}".
    `;

  const step2Schema: Schema = {
    type: Type.OBJECT,
    properties: {
      retraining: {
          type: Type.OBJECT,
          properties: {
          exercises: {
              type: Type.ARRAY,
              items: {
              type: Type.OBJECT,
              properties: {
                  type: { type: Type.STRING, enum: ['Academic Upgrade', 'Logic Bridge', 'Intent Realization'] },
                  question: { type: Type.STRING },
                  originalContext: { type: Type.STRING, description: "The starting sentence or context to improve." },
                  hint: { type: Type.STRING, description: "Pointer to the model strategy (Chinese)." },
                  mandatoryKeywords: { 
                    type: Type.ARRAY, 
                    items: { type: Type.STRING },
                    description: "Required keywords for the student to use"
                  },
                  referenceAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING, description: "Explanation in Chinese." }
              },
              required: ["type", "question", "originalContext", "hint", "mandatoryKeywords", "referenceAnswer", "explanation"]
              }
          },
          materials: {
              type: Type.ARRAY,
              items: {
              type: Type.OBJECT,
              properties: {
                  wordOrPhrase: { type: Type.STRING },
                  definition: { type: Type.STRING, description: "Chinese definition" },
                  example: { type: Type.STRING }
              },
              required: ["wordOrPhrase", "definition", "example"]
              }
          }
          },
          required: ["exercises", "materials"]
      }
    },
    required: ["retraining"]
  };

  const step2Json = await callAI(step2SystemPrompt, "Generate Integrated Retraining Exercises.", step2Schema, { temperature: 0.3 });
  
  let step2Data: any;
  try {
    step2Data = JSON.parse(step2Json);
  } catch (parseError) {
    console.error('Step 2 JSON parse failed. Raw response:', step2Json.substring(0, 500));
    // Step 2 失败不应阻断整个批改流程，返回空的 retraining
    step2Data = { retraining: { exercises: [], materials: [] } };
  }

  // 确保 retraining 结构完整
  const retraining = step2Data.retraining || { exercises: [], materials: [] };
  retraining.exercises = Array.isArray(retraining.exercises) ? retraining.exercises : [];
  retraining.materials = Array.isArray(retraining.materials) ? retraining.materials : [];

  // 6. Merge and Return
  // 合并：Step 1a 评分 + Critique 批注 + Polish 范文 + Step 2 练习
  return { ...critiqueData, ...polishData, totalScore: scoringData.totalScore, subScores: scoringData.subScores, retraining };
};

// --- Module 3: Sentence Drills ---

export const fetchDrillItems = async (topic: string, mode: DrillMode, context: AdaptiveContext): Promise<DrillItem[]> => {
  const schema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING },
        mode: { type: Type.STRING },
        questionContext: { type: Type.STRING },
        highlightText: { type: Type.STRING },
        options: { type: Type.ARRAY, items: { type: Type.STRING } },
        correctOption: { type: Type.STRING },
        explanation: { type: Type.STRING }
      },
      required: ['id', 'mode', 'questionContext', 'options', 'correctOption', 'explanation']
    }
  };

  let specificPrompt = "";
  if (mode === 'grammar_doctor') {
    specificPrompt = `Focus on grammar errors. Context errors: ${context.pastErrors.join(', ')}. Generate error correction drills.`;
  } else if (mode === 'elevation_lab') {
    specificPrompt = `Focus on vocabulary upgrade. Target vocab: ${context.targetVocab.join(', ')}. Generate sentence upgrade drills.`;
  } else {
    specificPrompt = `Focus on sentence structure combining. Generate sentence combining drills.`;
  }

  const userPrompt = `Topic: ${topic}
  Mode: ${mode}
  ${specificPrompt}
  Generate 5 drill items.

  STRICT LANGUAGE RULES:
  1. The \`explanation\` field MUST be in SIMPLIFIED CHINESE (简体中文) to help students understand the logic.
  2. Keep \`questionContext\`, \`highlightText\`, and \`options\` in English.`;
  const res = await callAI("Drill generator", userPrompt, schema);
  return safeJsonParse(res, 'fetchDrillItems');
};

// services/geminiService.ts

export const evaluateRetrainingAttempt = async (
  question: string, 
  strategyHint: string, 
  userAnswer: string
): Promise<{ status: 'pass' | 'partial' | 'fail', feedback: string }> => {
  
  const schema: Schema = {
    type: Type.OBJECT,
    properties: {
      status: { type: Type.STRING, enum: ['pass', 'partial', 'fail'] },
      feedback: { type: Type.STRING }
    },
    required: ['status', 'feedback']
  };

  const systemPrompt = `You are a strict Writing Coach. 
  The student is practicing a specific writing strategy: "${strategyHint}".
  The question was: "${question}".
  
  Evaluate the student's answer: "${userAnswer}".
  
  Rules:
  1. If they successfully applied the strategy and grammar is correct -> 'pass'.
  2. If they tried the strategy but made grammar errors or used it weakly -> 'partial'.
  3. If they ignored the strategy or wrote gibberish -> 'fail'.
  
  Feedback must be in SIMPLIFIED CHINESE, brief (1 sentence), addressing the strategy application.`;

  const res = await callAI(systemPrompt, "Evaluate Answer", schema);
  return safeJsonParse(res, 'evaluateRetrainingAttempt');
};