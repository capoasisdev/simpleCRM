import React from 'react';
import Skeleton from './common/Skeleton';
import '../styles/lateron-skeleton.css';

export default function LaterOnSkeleton({ isLoaded = false }) {
  return (
    <div
      className={`lateron-skeleton-container ${isLoaded ? 'fade-out' : ''}`}
      aria-label="Loading LaterOn Automation Dashboard"
    >
      {/* ================= MOBILE VIEW (<= 768px) ================= */}
      <div className="lateron-skel-mobile-view">
        {/* Mobile Header Bar */}
        <header className="lateron-skel-mobile-header">
          <div className="lateron-skel-mobile-profile">
            <Skeleton width="36px" height="36px" borderRadius="8px" />
            <div className="lateron-skel-mobile-profile-text">
              <Skeleton width="86px" height="13px" borderRadius="3px" />
              <Skeleton width="48px" height="10px" borderRadius="3px" />
            </div>
          </div>
          <div className="lateron-skel-mobile-toggle">
            <div className="lateron-skel-toggle-inner" />
          </div>
        </header>

        {/* Mobile Main Body */}
        <div className="lateron-skel-mobile-body">
          {/* Centered Heading */}
          <div className="lateron-skel-mobile-title-wrap">
            <Skeleton width="180px" height="22px" borderRadius="4px" />
          </div>

          {/* 2x2 Large Service Cards Grid */}
          <div className="lateron-skel-mobile-grid">
            {/* WhatsApp */}
            <div className="lateron-skel-mobile-card whatsapp">
              <div className="lateron-skel-mobile-icon-box whatsapp">
                <Skeleton width="22px" height="22px" borderRadius="6px" />
              </div>
              <Skeleton width="76px" height="15px" borderRadius="3px" />
              <Skeleton width="56px" height="11px" borderRadius="3px" />
            </div>

            {/* Email */}
            <div className="lateron-skel-mobile-card email">
              <div className="lateron-skel-mobile-icon-box email">
                <Skeleton width="22px" height="22px" borderRadius="6px" />
              </div>
              <Skeleton width="54px" height="15px" borderRadius="3px" />
              <Skeleton width="56px" height="11px" borderRadius="3px" />
            </div>

            {/* Meetings */}
            <div className="lateron-skel-mobile-card meetings">
              <div className="lateron-skel-mobile-icon-box meetings">
                <Skeleton width="22px" height="22px" borderRadius="6px" />
              </div>
              <Skeleton width="70px" height="15px" borderRadius="3px" />
              <Skeleton width="56px" height="11px" borderRadius="3px" />
            </div>

            {/* Personal Reminders */}
            <div className="lateron-skel-mobile-card reminders">
              <div className="lateron-skel-mobile-icon-box reminders">
                <Skeleton width="22px" height="22px" borderRadius="6px" />
              </div>
              <Skeleton width="92px" height="15px" borderRadius="3px" />
              <Skeleton width="64px" height="11px" borderRadius="3px" />
            </div>
          </div>
        </div>
      </div>

      {/* ================= DESKTOP VIEW (> 768px) ================= */}
      <div className="lateron-skel-desktop-view">
        {/* Two-Tone Page Backdrop: Dark Navy Top Banner */}
        <div className="lateron-skel-backdrop-banner">
          <div className="lateron-skel-brand">
            Later<span className="lateron-skel-brand-accent">On</span>
          </div>
        </div>

        {/* Floating App Window Frame */}
        <div className="lateron-skel-window-frame">
          {/* Left Sidebar */}
          <aside className="lateron-skel-sidebar">
            {/* Enclosed Profile Card Box */}
            <div className="lateron-skel-profile-box">
              <div className="lateron-skel-profile-left">
                <Skeleton circle height="34px" width="34px" />
                <div className="lateron-skel-profile-info">
                  <Skeleton width="85px" height="13px" borderRadius="3px" />
                  <Skeleton width="48px" height="10px" borderRadius="3px" />
                </div>
              </div>
              <div className="lateron-skel-profile-toggle" />
            </div>

            {/* 2x2 Services Grid */}
            <div className="lateron-skel-grid">
              {/* WhatsApp */}
              <div className="lateron-skel-service-card whatsapp">
                <div className="lateron-skel-icon-box">
                  <Skeleton width="20px" height="20px" borderRadius="6px" />
                </div>
                <Skeleton width="62px" height="12px" borderRadius="3px" />
                <Skeleton width="46px" height="9px" borderRadius="3px" />
              </div>

              {/* Email */}
              <div className="lateron-skel-service-card email">
                <div className="lateron-skel-icon-box">
                  <Skeleton width="20px" height="20px" borderRadius="6px" />
                </div>
                <Skeleton width="48px" height="12px" borderRadius="3px" />
                <Skeleton width="46px" height="9px" borderRadius="3px" />
              </div>

              {/* Meetings */}
              <div className="lateron-skel-service-card meetings">
                <div className="lateron-skel-icon-box">
                  <Skeleton width="20px" height="20px" borderRadius="6px" />
                </div>
                <Skeleton width="56px" height="12px" borderRadius="3px" />
                <Skeleton width="46px" height="9px" borderRadius="3px" />
              </div>

              {/* Personal Reminders */}
              <div className="lateron-skel-service-card reminders">
                <div className="lateron-skel-icon-box">
                  <Skeleton width="20px" height="20px" borderRadius="6px" />
                </div>
                <Skeleton width="66px" height="12px" borderRadius="3px" />
                <Skeleton width="50px" height="9px" borderRadius="3px" />
              </div>
            </div>
          </aside>

          {/* Right Main Workspace */}
          <main className="lateron-skel-main">
            {/* Top Tabs */}
            <div className="lateron-skel-tabs-row">
              <div className="lateron-skel-tabs-left">
                <div className="lateron-skel-tab-active">
                  <Skeleton width="92px" height="14px" borderRadius="3px" />
                  <div className="lateron-skel-tab-indicator" />
                </div>
                <Skeleton width="88px" height="14px" borderRadius="3px" />
              </div>
              <div className="lateron-skel-tabs-right">
                <Skeleton circle height="24px" width="24px" />
                <Skeleton circle height="24px" width="24px" />
              </div>
            </div>

            {/* Centered Content Column */}
            <div className="lateron-skel-center-wrap">
              {/* Elevated No Upcoming Messages Card */}
              <div className="lateron-skel-empty-card">
                <Skeleton width="46px" height="38px" borderRadius="8px" />
                <Skeleton width="180px" height="16px" borderRadius="4px" />
                <Skeleton width="220px" height="11px" borderRadius="3px" />
              </div>

              {/* 3 History List Cards */}
              {[1, 2, 3].map((item) => (
                <div key={item} className="lateron-skel-history-card">
                  <div className="lateron-skel-history-left">
                    <Skeleton circle height="30px" width="30px" />
                    <div className="lateron-skel-history-info">
                      <Skeleton width="110px" height="12px" borderRadius="3px" />
                      <Skeleton width={item === 2 ? '160px' : '90px'} height="10px" borderRadius="3px" />
                    </div>
                  </div>
                  <div className="lateron-skel-history-right">
                    <Skeleton width="34px" height="10px" borderRadius="2px" />
                    <Skeleton width="40px" height="9px" borderRadius="2px" />
                  </div>
                </div>
              ))}

              {/* Footer View Full History Link */}
              <div className="lateron-skel-footer-link">
                <Skeleton width="130px" height="11px" borderRadius="3px" />
              </div>
            </div>
          </main>
        </div>

        {/* Floating Bottom Right Gradient Widget */}
        <div className="lateron-skel-float-widget">
          <div className="lateron-skel-float-bar" />
          <div className="lateron-skel-float-bar" />
        </div>
      </div>
    </div>
  );
}
