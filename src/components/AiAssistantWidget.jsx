/**
 * AiAssistantWidget.jsx - Live CRM AI Assistant with Interactive 3D Robot Mascot
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Check,
  Copy,
  ThumbsUp,
  ThumbsDown
} from 'lucide-react';
import {
  askAiAssistant,
  executeCrmAction
} from '../lib/aiAssistant';
import { logAiInteraction, updateAiFeedback } from '../lib/aiLogger';
import { formatAssistantMarkdown } from '../lib/markdownFormatter';
import '../styles/aiAssistant.css';

const INITIAL_MESSAGES = [
  {
    id: 'welcome',
    sender: 'assistant',
    text: `How can I help you with your CRM leads, pipeline, or tasks today?`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
];

export default function AiAssistantWidget({
  leads = [],
  deals = [],
  pipelinesList = [],
  usersList = [],
  currentUser = {},
  activities = [],
  onNavigate
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [inputQuery, setInputQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [actionStatuses, setActionStatuses] = useState({}); // { [actionId]: 'executed' | 'error' }
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [feedbackMap, setFeedbackMap] = useState({});
  const [streamingMsgId, setStreamingMsgId] = useState(null);
  const sessionIdRef = useRef('sess_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now());

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Initial scroll to bottom when opening the chat widget
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [isOpen]);

  // Auto-grow textarea with content up to max-height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 110)}px`;
    }
  }, [inputQuery]);

  // Handle User Message Submission
  const handleSendMessage = async (queryText) => {
    const textToSend = (queryText || inputQuery).trim();
    if (!textToSend || isTyping) return;

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `ai-${Date.now()}`;
    const newMsg = {
      id: userMsgId,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, newMsg]);
    setInputQuery('');
    setIsTyping(true);
    setStreamingMsgId(assistantMsgId);

    // Scroll down to show user question and typing indicator
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 30);

    let hasScrolledToResponseTop = false;

    try {
      const response = await askAiAssistant(textToSend, {
        leads,
        deals,
        pipelinesList,
        usersList,
        currentUser,
        chatHistory: messages,
        activities,
        onChunk: (partialText) => {
          setIsTyping(false); // Hide dots once stream begins
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === assistantMsgId);
            if (exists) {
              return prev.map((m) =>
                m.id === assistantMsgId ? { ...m, text: partialText } : m
              );
            } else {
              return [
                ...prev,
                {
                  id: assistantMsgId,
                  sender: 'assistant',
                  text: partialText,
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }
              ];
            }
          });

          // Anchor response top at top of viewport so user can read naturally from beginning
          if (!hasScrolledToResponseTop) {
            hasScrolledToResponseTop = true;
            requestAnimationFrame(() => {
              const rowEl = document.getElementById(`msg-${assistantMsgId}`);
              if (rowEl) {
                rowEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            });
          }
        }
      });

      setStreamingMsgId(null);

      const assistantMsg = {
        id: assistantMsgId,
        sender: 'assistant',
        text: response.text,
        action: response.action,
        draftContent: response.draftContent,
        model: response.model,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages((prev) => {
        const exists = prev.some((m) => m.id === assistantMsgId);
        if (exists) {
          return prev.map((m) => (m.id === assistantMsgId ? assistantMsg : m));
        } else {
          return [...prev, assistantMsg];
        }
      });

      // Keep response anchored at top upon completion
      requestAnimationFrame(() => {
        const rowEl = document.getElementById(`msg-${assistantMsgId}`);
        if (rowEl) {
          rowEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });

      // Silently log conversation in background to Supabase for model training
      logAiInteraction({
        sessionId: sessionIdRef.current,
        userQuery: textToSend,
        assistantResponse: response.text,
        modelUsed: response.model || 'openrouter',
        currentUser
      }).then((logId) => {
        if (logId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, logId } : m))
          );
        }
      });
    } catch (err) {
      console.error('Error generating AI response:', err);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== assistantMsgId),
        {
          id: `ai-err-${Date.now()}`,
          sender: 'assistant',
          text: `⚠️ Apologies, I encountered an issue analyzing the CRM data. Please try again.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsTyping(false);
      setStreamingMsgId(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Execute Action (Confirm Action Button)
  const handleExecuteAction = async (msgId, action) => {
    if (actionStatuses[msgId] === 'executed') return;

    const res = await executeCrmAction(action, { currentUser });
    if (res.success) {
      setActionStatuses((prev) => ({ ...prev, [msgId]: 'executed' }));
      setMessages((prev) => [
        ...prev,
        {
          id: `act-res-${Date.now()}`,
          sender: 'assistant',
          text: `✅ **Action Confirmed:** ${res.message}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } else {
      setActionStatuses((prev) => ({ ...prev, [msgId]: 'error' }));
      alert(res.message);
    }
  };

  // Copy Draft to Clipboard
  const handleCopyDraft = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopyFeedback(id);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  // Submit Feedback (thumbs up / thumbs down) for Training Data
  const handleFeedback = (msgId, logId, type) => {
    const current = feedbackMap[msgId];
    const newFeedback = current === type ? null : type;
    setFeedbackMap((prev) => ({ ...prev, [msgId]: newFeedback }));
    if (logId) {
      updateAiFeedback(logId, newFeedback);
    }
  };

  return (
    <div className="crm-ai-floating-widget">
      {/* 1. Collapsed State: 3D Mascot CTA */}
      {!isOpen && (
        <button
          className="container-wrap"
          onClick={() => setIsOpen(true)}
          aria-label="Open AI Assistant"
        >
          <div className="card">
            <div className="background-blur-balls">
              <div className="balls">
                <span className="ball rosa"></span>
                <span className="ball violet"></span>
                <span className="ball green"></span>
                <span className="ball cyan"></span>
              </div>
            </div>

            <div className="content-card">
              <div className="background-blur-card">
                <div className="eyes">
                  <span className="eye"></span>
                  <span className="eye"></span>
                </div>
                <div className="eyes happy">
                  <svg fill="none" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M8.28386 16.2843C8.9917 15.7665 9.8765 14.731 12 14.731C14.1235 14.731 15.0083 15.7665 15.7161 16.2843C17.8397 17.8376 18.7542 16.4845 18.9014 15.7665C19.4323 13.1777 17.6627 11.1066 17.3088 10.5888C16.3844 9.23666 14.1235 8 12 8C9.87648 8 7.61556 9.23666 6.69122 10.5888C6.33728 11.1066 4.56771 13.1777 5.09858 15.7665C5.24582 16.4845 6.16034 17.8376 8.28386 16.2843Z"
                    />
                  </svg>
                  <svg fill="none" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M8.28386 16.2843C8.9917 15.7665 9.8765 14.731 12 14.731C14.1235 14.731 15.0083 15.7665 15.7161 16.2843C17.8397 17.8376 18.7542 16.4845 18.9014 15.7665C19.4323 13.1777 17.6627 11.1066 17.3088 10.5888C16.3844 9.23666 14.1235 8 12 8C9.87648 8 7.61556 9.23666 6.69122 10.5888C6.33728 11.1066 4.56771 13.1777 5.09858 15.7665C5.24582 16.4845 6.16034 17.8376 8.28386 16.2843Z"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </button>
      )}

      {/* 2. Expanded State: Minimal Clean Assistant */}
      {isOpen && (
        <div className="crm-ai-chat-window">
          {/* Header */}
          <div className="crm-ai-header">
            <div className="crm-ai-header-left">
              <span className="crm-ai-header-title">AI Assistant</span>
            </div>

            <div className="crm-ai-header-close-wrap">
              <button
                className="crm-ai-header-close-btn"
                title="Close"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Messages Body */}
          <div className="crm-ai-messages">
            {messages.map((m) => {
              const isAssistant = m.sender === 'assistant';
              const isExecuted = actionStatuses[m.id] === 'executed';

              return (
                <div key={m.id} id={`msg-${m.id}`} className={`crm-ai-message-row ${m.sender}`}>
                  <div className="crm-ai-bubble">
                    <div
                      className="crm-ai-bubble-content"
                      onClick={(e) => {
                        const row = e.target.closest('.crm-ai-clickable-row');
                        if (row && row.dataset?.leadName && !isTyping) {
                          handleSendMessage(`give details of ${row.dataset.leadName}`);
                        }
                      }}
                    >
                      <span
                        dangerouslySetInnerHTML={{
                          __html: formatAssistantMarkdown(m.text)
                        }}
                      />
                      {streamingMsgId === m.id && (
                        <span className="crm-ai-streaming-cursor" title="Generating response..." />
                      )}
                    </div>

                    {/* Interactive Action Card if AI generated a task or action */}
                    {isAssistant && m.action && (
                      <div className="crm-ai-action-card">
                        <div className="crm-ai-action-card-header">
                          <span>⚡ Proposed Action</span>
                          {isExecuted && (
                            <span style={{ color: '#10b981', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Check size={13} /> Completed
                            </span>
                          )}
                        </div>
                        <div className="crm-ai-action-card-body">
                          {m.action.title || 'Execute CRM Action'}
                        </div>
                        <div className="crm-ai-action-btn-row">
                          <button
                            className={`crm-ai-confirm-btn ${isExecuted ? 'executed' : ''}`}
                            onClick={() => handleExecuteAction(m.id, m.action)}
                            disabled={isExecuted}
                          >
                            {isExecuted ? 'Action Applied' : 'Confirm & Execute'}
                          </button>

                          {(m.draftContent || m.action.draftText) && (
                            <button
                              className="crm-ai-copy-btn"
                              onClick={() =>
                                handleCopyDraft(
                                  m.draftContent || m.action.draftText,
                                  m.id
                                )
                              }
                            >
                              {copyFeedback === m.id ? (
                                <>
                                  <Check size={13} color="#10b981" /> Copied!
                                </>
                              ) : (
                                <>
                                  <Copy size={13} /> Copy Message
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ChatGPT-style subtle action footer for assistant response */}
                  {isAssistant && m.id !== 'welcome' ? (
                    <div className="crm-ai-msg-footer">
                      <div className="crm-ai-msg-actions-left">
                        <button
                          className="crm-ai-msg-action-btn"
                          title="Copy response"
                          onClick={() => handleCopyDraft(m.text, m.id)}
                        >
                          {copyFeedback === m.id ? (
                            <>
                              <Check size={12} color="#10b981" />
                              <span style={{ color: '#10b981' }}>Copied</span>
                            </>
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>

                        <button
                          className={`crm-ai-msg-action-btn ${feedbackMap[m.id] === 'thumbs_up' ? 'active-up' : ''}`}
                          title="Helpful & accurate"
                          onClick={() => handleFeedback(m.id, m.logId, 'thumbs_up')}
                        >
                          <ThumbsUp size={12} />
                        </button>

                        <button
                          className={`crm-ai-msg-action-btn ${feedbackMap[m.id] === 'thumbs_down' ? 'active-down' : ''}`}
                          title="Needs improvement"
                          onClick={() => handleFeedback(m.id, m.logId, 'thumbs_down')}
                        >
                          <ThumbsDown size={12} />
                        </button>
                      </div>

                      <span className="crm-ai-msg-time">{m.timestamp}</span>
                    </div>
                  ) : (
                    <span className="crm-ai-msg-time">{m.timestamp}</span>
                  )}
                </div>
              );
            })}

            {isTyping && (
              <div className="crm-ai-message-row assistant">
                <div className="crm-ai-typing">
                  <span className="crm-ai-typing-dot"></span>
                  <span className="crm-ai-typing-dot"></span>
                  <span className="crm-ai-typing-dot"></span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Chat Input Form matching User's Specs */}
          <div className="crm-ai-input-area">
            <div className="crm-ai-chat-box">
              <textarea
                ref={textareaRef}
                placeholder="Ask about leads, request analysis, draft messages..."
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              {/* User's Gradient Submit Button */}
              <button
                className="crm-ai-btn-submit"
                onClick={() => handleSendMessage()}
                disabled={!inputQuery.trim() || isTyping}
                aria-label="Send message"
              >
                <i>
                  <svg viewBox="0 0 512 512">
                    <path
                      d="M473 39.05a24 24 0 0 0-25.5-5.46L47.47 185h-.08a24 24 0 0 0 1 45.16l.41.13l137.3 58.63a16 16 0 0 0 15.54-3.59L422 80a7.07 7.07 0 0 1 10 10L226.66 310.26a16 16 0 0 0-3.59 15.54l58.65 137.38c.06.2.12.38.19.57c3.2 9.27 11.3 15.81 21.09 16.25h1a24.63 24.63 0 0 0 23-15.46L478.39 64.62A24 24 0 0 0 473 39.05"
                      fill="currentColor"
                    />
                  </svg>
                </i>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
