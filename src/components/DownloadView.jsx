import { Download, ArrowRight } from 'lucide-react';
import '../styles/download.css';

export default function DownloadView({ onGoToWeb }) {
  return (
    <main className="download-page">
      <div className="download-card">
        {/* Clean Logo Mark */}
        <div className="download-logo-wrap">
          <img
            src="/logo_cropped.png"
            alt="simplecrm logo"
            className="download-logo-img"
          />
        </div>

        {/* Heading & Subtitle */}
        <h1 className="download-title">simplecrm for Android</h1>
        <p className="download-subtitle">
          Direct mobile access to your leads, pipelines, and conversations.
        </p>

        {/* Primary Download Action */}
        <a
          href="/simplecrm.apk"
          download="simplecrm.apk"
          className="download-btn"
        >
          <Download size={16} strokeWidth={2.2} />
          <span>Download Android App</span>
        </a>

        {/* File Metadata */}
        <div className="download-meta">
          <span>APK File</span>
          <span className="download-meta-dot">·</span>
          <span>v1.0.11</span>
          <span className="download-meta-dot">·</span>
          <span>Android 8.0+</span>
        </div>

        {/* 2-Step Installation Guide */}
        <div className="download-instructions">
          <div className="download-inst-header">How to install</div>
          <div className="download-inst-row">
            <span className="download-inst-num">1</span>
            <span>Tap Download above to save the <code>.apk</code> to your device.</span>
          </div>
          <div className="download-inst-row">
            <span className="download-inst-num">2</span>
            <span>Open the downloaded file. If prompted, allow "Install unknown apps" in browser settings.</span>
          </div>
        </div>

        {/* Link to Web Application */}
        <button
          type="button"
          className="download-web-link"
          onClick={() => {
            if (onGoToWeb) {
              onGoToWeb();
            } else {
              window.location.href = '/dashboard';
            }
          }}
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <span>Open Web Application</span>
          <ArrowRight size={13} strokeWidth={2} />
        </button>
      </div>
    </main>
  );
}
