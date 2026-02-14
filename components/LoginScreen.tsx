
import React, { useState } from 'react';
import { User } from '../types';
import { supabase } from '../services/supabaseClient';
import { setCurrentUserId } from '../services/supabaseService';

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !studentId.trim()) {
      setError('请输入姓名和学号');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 调用安全的注册函数（绕过 RLS）
      const { data, error } = await supabase.rpc('register_student', {
        p_student_id: studentId.trim(),
        p_name: name.trim(),
        p_email: `${studentId.trim()}@temp.local`,
      });

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        throw new Error('注册失败，请稍后重试');
      }

      const user = data[0];
      setCurrentUserId(user.id);
      onLogin({ name: user.name, studentId: user.student_id });
    } catch (err: any) {
      console.error('登录失败:', err);
      setError(err.message || '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white max-w-md w-full rounded-2xl shadow-xl border border-slate-100 p-8 animate-fade-in-up">
        
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-900 rounded-xl flex items-center justify-center text-white font-serif font-bold text-3xl shadow-md border-2 border-blue-800 mx-auto mb-4">
            C
          </div>
          <h1 className="text-2xl font-serif font-bold text-slate-800">CET-4/6 Writing Coach</h1>
          <p className="text-slate-500 text-sm mt-2">大学英语四六级写作辅助系统</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="name" className="block text-sm font-bold text-slate-700 mb-2">姓名 (Name)</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入您的真实姓名"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all text-slate-800"
            />
          </div>

          <div>
            <label htmlFor="studentId" className="block text-sm font-bold text-slate-700 mb-2">学号 (Student ID)</label>
            <input
              id="studentId"
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="请输入您的学号"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none transition-all text-slate-800"
            />
          </div>

          {error && (
            <div className="text-rose-500 text-sm bg-rose-50 p-3 rounded-lg text-center font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-xl font-bold text-white bg-blue-900 hover:bg-blue-950 shadow-md transition-colors flex items-center justify-center gap-2 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>登录中...</span>
              </>
            ) : (
              '开始学习 (Start Learning)'
            )}
          </button>
        </form>
        
        <div className="mt-8 text-center border-t border-slate-100 pt-6">
          <p className="text-xs text-slate-400">
            * 仅供本校学生使用，系统将自动记录学习时长与进度。
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
