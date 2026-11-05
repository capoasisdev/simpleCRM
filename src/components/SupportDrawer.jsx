import { useState, useEffect, useRef } from 'react';
import { X, Send, CheckCircle2, Loader2, MessageSquare, Paperclip, Phone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import '../styles/support.css';

const MAX_ATTACHMENTS = 4;
const MAX_DIMENSION = 1600;

const optimizeImage = (file) => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('File must be an image.'));
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const quality = mime === 'image/jpeg' ? 0.82 : undefined;
        const dataUrl = canvas.toDataURL(mime, quality);

        resolve({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name || `screenshot-${Date.now()}.png`,
          type: mime,
          size: Math.round((dataUrl.length * 3) / 4),
          data: dataUrl
        });
      };
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
};

export default function SupportDrawer({
  isOpen,
  onClose,
  currentUser = {}
}) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setIsSuccess(false);
      setErrorMsg('');
      setMessage('');
      setAttachments([]);
      setIsDragging(false);
      setIsProcessingImages(false);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 60);

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const userEmail = currentUser?.email || 'user@simplecrm.com';
  const userName = currentUser?.name || 'CRM Team Member';

  const processFiles = async (files) => {
    if (!files || files.length === 0) return;
    if (attachments.length >= MAX_ATTACHMENTS) {
      setErrorMsg(`Maximum of ${MAX_ATTACHMENTS} images allowed per note.`);
      return;
    }

    const remainingSlots = MAX_ATTACHMENTS - attachments.length;
    const toProcess = files.slice(0, remainingSlots);

    setIsProcessingImages(true);
    setErrorMsg('');

    try {
      const processed = [];
      for (const file of toProcess) {
        if (!file.type.startsWith('image/')) continue;
        const optimized = await optimizeImage(file);
        processed.push(optimized);
      }

      if (processed.length === 0 && files.length > 0) {
        setErrorMsg('Please select valid image files (.png, .jpg, .webp).');
      } else {
        setAttachments((prev) => [...prev, ...processed]);
      }
    } catch (err) {
      console.error('Image processing error:', err);
      setErrorMsg(err.message || 'Failed to attach image.');
    } finally {
      setIsProcessingImages(false);
    }
  };

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      await processFiles(imageFiles);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        await processFiles(imageFiles);
      }
    }
  };

  const handleFileSelect = async (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processFiles(Array.from(files));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveAttachment = (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const cleanMsg = message.trim();
    if (!cleanMsg) {
      setErrorMsg('Please write your note before sending.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const ticketPayload = {
        user_id: currentUser?.id ? String(currentUser.id) : null,
        user_name: userName,
        user_email: userEmail,
        type: 'feedback',
        subject: attachments.length > 0
          ? `[Reference Attached] Note from ${userName}`
          : `Note from ${userName}`,
        message: cleanMsg,
        status: 'open',
        metadata: {
          submitted_at: new Date().toISOString(),
          user_role: currentUser?.role || 'user',
          pathname: window.location.pathname,
          attachments_count: attachments.length,
          attachments: attachments.map((a) => ({
            name: a.name,
            type: a.type,
            size: a.size,
            data: a.data
          }))
        }
      };

      const { error } = await supabase
        .from('support_tickets')
        .insert([ticketPayload]);

      if (error) throw error;

      setIsSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err) {
      console.error('Error submitting feedback note:', err);
      setErrorMsg(err.message || 'Failed to send note. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="support-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="support-modal-dialog" role="dialog" aria-label="Feedback & Support">
        <div className="support-modal-header">
          <div className="support-modal-title-group">
            <div className="support-modal-icon-badge">
              <MessageSquare size={16} strokeWidth={2} />
            </div>
            <div>
              <h2 className="support-modal-title">Feedback & Support</h2>
            </div>
          </div>
          <div className="support-header-phone" title="Developer Contact: +91 91563 67501">
            <Phone size={13} strokeWidth={2} />
            <span>+91 91563 67501</span>
          </div>
        </div>

        {isSuccess ? (
          <div className="support-modal-success">
            <CheckCircle2 size={32} strokeWidth={2.2} className="support-success-icon" />
            <h3 className="support-success-heading">Note Sent</h3>
            <p className="support-success-subheading">Thank you! Your note has been delivered directly to the developers.</p>
          </div>
        ) : (
          <form onSubmit={handleSend} className="support-modal-form">
            <div
              className={`support-modal-body ${isDragging ? 'is-dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <textarea
                ref={textareaRef}
                className="support-modal-textarea"
                placeholder="What's on your mind? Found a bug or have an idea? Type here... (Paste screenshots with ⌘+V)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onPaste={handlePaste}
                rows={6}
                maxLength={2000}
                disabled={isSubmitting}
              />

              {attachments.length > 0 && (
                <div className="support-thumbnails-list">
                  {attachments.map((att) => (
                    <div key={att.id} className="support-thumbnail-item" title={att.name}>
                      <img src={att.data} alt={att.name} className="support-thumbnail-img" />
                      <button
                        type="button"
                        className="support-thumbnail-remove"
                        onClick={() => handleRemoveAttachment(att.id)}
                        aria-label="Remove image"
                        title="Remove image"
                      >
                        <X size={11} strokeWidth={2.5} />
                      </button>
                      <span className="support-thumbnail-name">{att.name}</span>
                    </div>
                  ))}
                  {isProcessingImages && (
                    <div className="support-thumbnail-loading">
                      <Loader2 size={15} className="support-spinner" />
                      <span>Compressing...</span>
                    </div>
                  )}
                </div>
              )}

              {errorMsg && <div className="support-modal-error">{errorMsg}</div>}
            </div>

            <div className="support-modal-footer">
              <div className="support-footer-left">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                  disabled={isSubmitting || isProcessingImages || attachments.length >= MAX_ATTACHMENTS}
                />
                <button
                  type="button"
                  className="support-btn-attach"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting || isProcessingImages || attachments.length >= MAX_ATTACHMENTS}
                  title={attachments.length >= MAX_ATTACHMENTS ? "Maximum 4 images attached" : "Attach screenshot or reference image (or paste ⌘+V)"}
                >
                  <Paperclip size={14} strokeWidth={2} />
                  <span>
                    {attachments.length === 0
                      ? 'Attach image'
                      : `Attach image (${attachments.length}/${MAX_ATTACHMENTS})`}
                  </span>
                </button>
              </div>

              <div className="support-footer-right">
                <button
                  type="button"
                  className="support-btn-cancel"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="support-btn-send"
                  disabled={isSubmitting || isProcessingImages || !message.trim()}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={14} className="support-spinner" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <Send size={13} strokeWidth={2} />
                      <span>Send Note</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
