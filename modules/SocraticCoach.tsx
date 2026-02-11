
import React, { useState, useEffect, useRef } from 'react';
import InputSection from '../components/InputSection';
import PhaseOneCards from '../components/PhaseOneCards';
import ResultsDisplay from '../components/ResultsDisplay';
import HistoryModal from '../components/HistoryModal';
import { fetchInspirationCards, fetchLanguageScaffolds, generateEssayIntroConclusion } from '../services/geminiService';
import { getHistory, deleteFromHistory, saveToHistory, checkIsSaved } from '../services/storageService';
import { UserInput, InspirationCard, ScaffoldContent, FlowState, HistoryItem, InspirationHistoryData, DimensionDraft } from '../types';

interface SocraticCoachProps {
  onSendToGrader?: (topic: string, essay: string) => void;
}

const SocraticCoach: React.FC<SocraticCoachProps> = ({ onSendToGrader }) => {
  const [flowState, setFlowState] = useState<FlowState>('input_topic');
  const [currentTopic, setCurrentTopic] = useState<string>('');
  
  // Data State
  const [cards, setCards] = useState<InspirationCard[]>([]);
  const [activeCard, setActiveCard] = useState<InspirationCard | null>(null);
  const [scaffoldData, setScaffoldData] = useState<ScaffoldContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Phase 1 State (Lifted)
  const [step1Inputs, setStep1Inputs] = useState<Record<string, string>>({});

  // 维度草稿管理
  const [dimensionDrafts, setDimensionDrafts] = useState<Record<string, DimensionDraft>>({});
  const currentDraftRef = useRef<string>(''); // 用ref追踪实时草稿，避免频繁setState

  // 组合成文状态
  const [assembledEssay, setAssembledEssay] = useState<{ introduction: string; bodyParagraphs: { dimension: string; draft: string }[]; conclusion: string } | null>(null);
  const [isAssembling, setIsAssembling] = useState(false);

  // History State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);

  // Load history on mount
  const refreshHistory = () => {
    const scaffolds = getHistory('scaffold');
    const inspirations = getHistory('inspiration');
    setHistoryItems([...scaffolds, ...inspirations].sort((a,b) => b.timestamp - a.timestamp));
  };

  useEffect(() => {
    if (isHistoryOpen) refreshHistory();
  }, [isHistoryOpen]); 

  // Step 1: Handle Topic Input -> Fetch Cards
  const handleTopicSubmit = async (input: UserInput) => {
    setFlowState('loading_cards');
    setCurrentTopic(input.topic);
    setError(null);
    setActiveCard(null);
    setStep1Inputs({});
    setDimensionDrafts({}); // 新topic清空草稿

    try {
      const fetchedCards = await fetchInspirationCards(input.topic);
      setCards(fetchedCards);
      
      const historyData: InspirationHistoryData = {
        cards: fetchedCards,
        userInputs: {}
      };
      saveToHistory(input.topic, historyData, 'inspiration');

      setFlowState('selecting_card');
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate inspiration cards. Please try again.");
      setFlowState('error');
    }
  };

  // Handle Input Changes in Step 1
  const handleStep1InputChange = (id: string, value: string) => {
    setStep1Inputs(prev => ({ ...prev, [id]: value }));
  };

  // Step 2: Handle Card Selection + Idea -> Fetch Scaffolds
  const handleCardSelect = async (card: InspirationCard, userIdea: string) => {
    setFlowState('loading_scaffold');
    setError(null);
    setActiveCard(card);

    // 如果该维度已有scaffold数据，直接使用
    const existingDraft = dimensionDrafts[card.id];
    if (existingDraft?.scaffoldData) {
      setScaffoldData(existingDraft.scaffoldData);
      currentDraftRef.current = existingDraft.draft;
      setFlowState('showing_result');
      return;
    }

    try {
      const result = await fetchLanguageScaffolds(currentTopic, card.dimension, userIdea);
      setScaffoldData(result);
      currentDraftRef.current = '';
      saveToHistory(currentTopic, result, 'scaffold');
      setFlowState('showing_result');
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate language scaffolds. Please try again.");
      setFlowState('selecting_card'); 
    }
  };

  // 草稿实时更新回调
  const handleDraftChange = (draft: string) => {
    currentDraftRef.current = draft;
  };

  // 返回维度选择页面，同时保存当前草稿
  const handleBackToDimensions = () => {
    // 保存当前维度的草稿
    if (activeCard && currentDraftRef.current.trim()) {
      setDimensionDrafts(prev => ({
        ...prev,
        [activeCard.id]: {
          cardId: activeCard.id,
          dimension: activeCard.dimension,
          userIdea: step1Inputs[activeCard.id] || '',
          draft: currentDraftRef.current,
          scaffoldData: scaffoldData || undefined
        }
      }));
    }
    
    setFlowState('selecting_card');
    setScaffoldData(null);
  };

  // 组合成文
  const handleAssembleEssay = async () => {
    setIsAssembling(true);
    setFlowState('assembling_essay');
    
    const bodyParagraphs = cards
      .filter(card => dimensionDrafts[card.id])
      .map(card => ({
        dimension: card.dimension,
        draft: dimensionDrafts[card.id].draft
      }));

    try {
      const { introduction, conclusion } = await generateEssayIntroConclusion(currentTopic, bodyParagraphs);
      setAssembledEssay({ introduction, bodyParagraphs, conclusion });
    } catch (err: any) {
      console.error(err);
      // 即使AI生成失败，也允许用户手动编辑
      setAssembledEssay({
        introduction: '',
        bodyParagraphs,
        conclusion: ''
      });
    } finally {
      setIsAssembling(false);
    }
  };

  // 发送到作文批改
  const handleSendToGrader = () => {
    if (!assembledEssay || !onSendToGrader) return;
    
    const fullEssay = [
      assembledEssay.introduction,
      ...assembledEssay.bodyParagraphs.map(p => p.draft),
      assembledEssay.conclusion
    ].filter(p => p.trim()).join('\n\n');

    onSendToGrader(currentTopic, fullEssay);
  };

  const resetApp = () => {
    setFlowState('input_topic');
    setCards([]);
    setScaffoldData(null);
    setCurrentTopic('');
    setActiveCard(null);
    setStep1Inputs({});
    setDimensionDrafts({});
    setAssembledEssay(null);
    currentDraftRef.current = '';
  };

  // History Handlers
  const handleSelectHistoryItem = (item: HistoryItem) => {
    if (item.dataType === 'scaffold') {
        setCurrentTopic(item.topic);
        setScaffoldData(item.data as ScaffoldContent);
        setActiveCard(null); 
        setFlowState('showing_result');
        setIsHistoryOpen(false);
    } else if (item.dataType === 'inspiration') {
        const data = item.data as InspirationHistoryData;
        setCurrentTopic(item.topic);
        setCards(data.cards);
        setStep1Inputs(data.userInputs);
        setFlowState('selecting_card');
        setIsHistoryOpen(false);
    }
  };

  const handleDeleteHistoryItem = (id: string) => {
    deleteFromHistory(id);
    refreshHistory();
  };

  return (
    <div className="animate-fade-in-up">
      {/* Module Toolbar */}
      <div className="flex justify-end gap-3 mb-6 no-print">
         <button 
           onClick={() => setIsHistoryOpen(true)}
           className="text-sm font-medium text-slate-500 hover:text-brand-600 transition-colors flex items-center gap-1 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm"
         >
           <span>📂</span> History
         </button>
         <button onClick={resetApp} className="text-sm font-medium text-white bg-brand-600 px-3 py-1.5 rounded-lg hover:bg-brand-700 transition-colors shadow-sm">
           + New Topic
         </button>
      </div>

      {/* Intro Text (Only show at start) */}
      {flowState === 'input_topic' && (
        <div className="text-center mb-10 max-w-2xl mx-auto animate-fade-in-up no-print">
          <h2 className="text-3xl font-serif font-bold text-slate-800 mb-4">
            苏格拉底式<br className="md:hidden" /><span className="text-brand-600">写作思维训练</span>
          </h2>
          <p className="text-slate-600 text-lg leading-relaxed mb-8">
            "Thinking before Scaffolding" - 我们不直接给答案，而是通过启发提问引导你构建论据，再提供地道的语言支持。
          </p>
        </div>
      )}

      {/* --- Flow Controller --- */}
      
      {/* 1. Input Section */}
      {flowState === 'input_topic' && (
        <InputSection onSubmit={handleTopicSubmit} isLoading={false} />
      )}

      {/* 2. Loading Cards Animation */}
      {flowState === 'loading_cards' && (
        <div className="text-center py-20 animate-pulse no-print">
          <div className="inline-block p-4 rounded-full bg-white shadow-lg mb-6">
            <span className="text-4xl">🎲</span>
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">正在抽取盲盒维度...</h3>
          <p className="text-slate-500">苏格拉底教练正在思考启发性问题</p>
        </div>
      )}

      {/* 3. Phase 1: Card Selection */}
      {(flowState === 'selecting_card' || flowState === 'loading_scaffold') && (
        <div className="no-print">
          <PhaseOneCards 
            topic={currentTopic}
            cards={cards} 
            inputs={step1Inputs}
            onInputChange={handleStep1InputChange}
            onSelect={handleCardSelect} 
            isLoading={flowState === 'loading_scaffold'}
            dimensionDrafts={dimensionDrafts}
            onAssembleEssay={handleAssembleEssay}
          />
        </div>
      )}

      {/* 4. Phase 2: Results Display (with draft support) */}
      {flowState === 'showing_result' && scaffoldData && (
        <ResultsDisplay 
          data={scaffoldData} 
          topic={currentTopic} 
          socraticQuestion={activeCard?.socraticQuestion}
          onBack={handleBackToDimensions}
          initialDraft={activeCard ? (dimensionDrafts[activeCard.id]?.draft || '') : ''}
          onDraftChange={handleDraftChange}
        />
      )}

      {/* 5. Essay Assembly View */}
      {flowState === 'assembling_essay' && (
        <div className="max-w-4xl mx-auto animate-fade-in-up">
          {isAssembling ? (
            <div className="text-center py-20 animate-pulse">
              <div className="inline-block p-4 rounded-full bg-white shadow-lg mb-6">
                <span className="text-4xl">✍️</span>
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">AI 正在生成引言和结论...</h3>
              <p className="text-slate-500">根据你的段落内容，组合成完整的作文</p>
            </div>
          ) : assembledEssay && (
            <div className="space-y-6">
              {/* Header */}
              <div className="text-center mb-8">
                <h2 className="text-3xl font-serif font-bold text-slate-800 mb-2">
                  📝 <span className="text-emerald-600">组合成文</span>
                </h2>
                <p className="text-slate-500">编辑各个段落，完成后可一键发送到作文批改</p>
                <div className="mt-3 bg-white border border-slate-200 rounded-lg p-3 shadow-sm inline-flex items-center gap-3">
                  <span className="bg-brand-50 text-brand-700 text-[10px] font-bold px-2 py-1 rounded border border-brand-100 uppercase tracking-wider whitespace-nowrap">
                    Topic
                  </span>
                  <span className="font-bold text-slate-800 text-lg">{currentTopic}</span>
                </div>
              </div>

              {/* Essay Sections */}
              <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
                {/* Introduction */}
                <div className="border-b border-slate-100">
                  <div className="bg-blue-50 px-6 py-3 border-b border-blue-100">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-500 text-sm">🏁</span>
                      <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">引言 (Introduction)</span>
                      <span className="text-[10px] text-blue-400 ml-auto">AI 生成，可编辑</span>
                    </div>
                  </div>
                  <div className="p-6">
                    <textarea
                      value={assembledEssay.introduction}
                      onChange={(e) => setAssembledEssay(prev => prev ? { ...prev, introduction: e.target.value } : null)}
                      className="w-full p-4 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none resize-none text-slate-700 leading-relaxed text-sm min-h-[100px]"
                      placeholder="在此编辑引言段落..."
                    />
                  </div>
                </div>

                {/* Body Paragraphs */}
                {assembledEssay.bodyParagraphs.map((para, i) => (
                  <div key={i} className="border-b border-slate-100">
                    <div className="bg-emerald-50 px-6 py-3 border-b border-emerald-100">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-500 text-sm">📖</span>
                        <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
                          正文段落 {i + 1} — {para.dimension}
                        </span>
                        <span className="text-[10px] text-emerald-400 ml-auto">你的原创段落</span>
                      </div>
                    </div>
                    <div className="p-6">
                      <textarea
                        value={para.draft}
                        onChange={(e) => {
                          setAssembledEssay(prev => {
                            if (!prev) return null;
                            const newBody = [...prev.bodyParagraphs];
                            newBody[i] = { ...newBody[i], draft: e.target.value };
                            return { ...prev, bodyParagraphs: newBody };
                          });
                        }}
                        className="w-full p-4 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none resize-none text-slate-700 leading-relaxed text-sm min-h-[120px]"
                      />
                    </div>
                  </div>
                ))}

                {/* Conclusion */}
                <div>
                  <div className="bg-purple-50 px-6 py-3 border-b border-purple-100">
                    <div className="flex items-center gap-2">
                      <span className="text-purple-500 text-sm">🎯</span>
                      <span className="text-xs font-bold text-purple-600 uppercase tracking-wider">结论 (Conclusion)</span>
                      <span className="text-[10px] text-purple-400 ml-auto">AI 生成，可编辑</span>
                    </div>
                  </div>
                  <div className="p-6">
                    <textarea
                      value={assembledEssay.conclusion}
                      onChange={(e) => setAssembledEssay(prev => prev ? { ...prev, conclusion: e.target.value } : null)}
                      className="w-full p-4 rounded-xl border border-slate-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none resize-none text-slate-700 leading-relaxed text-sm min-h-[100px]"
                      placeholder="在此编辑结论段落..."
                    />
                  </div>
                </div>
              </div>

              {/* Word Count & Actions */}
              <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                <div className="text-sm text-slate-500">
                  总字数：<span className="font-bold text-slate-800">
                    {[assembledEssay.introduction, ...assembledEssay.bodyParagraphs.map(p => p.draft), assembledEssay.conclusion]
                      .join(' ').split(/\s+/).filter(w => w).length}
                  </span> words
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setFlowState('selecting_card')}
                    className="px-4 py-2 rounded-lg text-sm font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    ← 返回编辑
                  </button>

                  {onSendToGrader && (
                    <button
                      onClick={handleSendToGrader}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-lg hover:shadow-indigo-500/30 transition-all hover:-translate-y-0.5 flex items-center gap-2"
                    >
                      <span>🚀</span> 发送到作文批改 (Submit to Grader)
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {(flowState === 'error' || error) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-600 max-w-2xl mx-auto mt-8 no-print">
          <p className="font-bold text-lg mb-2">Something went wrong</p>
          <p>{error}</p>
          {error?.includes("API Key") && (
            <p className="text-xs mt-2 text-slate-500">
              请检查右上角设置中的 API Key，或联系管理员在 Netlify 后台配置环境变量。
            </p>
          )}
          <button onClick={resetApp} className="mt-4 underline font-bold hover:text-red-800">Try Again</button>
        </div>
      )}

      {/* History Modal */}
      <HistoryModal 
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={historyItems}
        onSelect={handleSelectHistoryItem}
        onDelete={handleDeleteHistoryItem}
        title="Thinking History"
      />
    </div>
  );
};

export default SocraticCoach;
