export default function ConversionJourney() {
  return (
    <section id="workflow" className="editorial-flow-section" aria-label="Product Workflow">
      <div className="editorial-flow-container">

        {/* Section Headline */}
        <div className="editorial-section-header" data-scroll-reveal="header">
          <h2 className="editorial-section-title">
            Feature Breakdown<span className="editorial-title-dot">.</span>
          </h2>
        </div>

        {/* -------------------------------------------------------------
            BLOCK 01: INBOUND SPEED & META WEBHOOKS
            ------------------------------------------------------------- */}
        <article className="editorial-story-block" data-scroll-reveal="story">
          <div className="editorial-lead-meta">
            <span className="editorial-index">01</span>
            <span className="editorial-category">Instant Ingestion</span>
          </div>
          <div className="editorial-main-content">
            <h2 className="editorial-statement">
              Leads get cold in five minutes.<br />
              <span className="editorial-statement-accent">simplecrm answers in three seconds.</span>
            </h2>
            <p className="editorial-description">
              When an inbound prospect submits a lead form on Instagram or Facebook, waiting 15 minutes for Zapier causes high-intent buyers to bounce. simplecrm connects directly to Meta’s server webhooks in under 12 milliseconds—delivering zero latency, zero connector fees, and 100% verified lead capture.
            </p>
            <div className="editorial-highlight-row" data-stagger-group="stats">
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">12ms</span>
                <span className="editorial-stat-label">Server webhook ingestion</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">Zero</span>
                <span className="editorial-stat-label">Zapier or connector delay</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">100%</span>
                <span className="editorial-stat-label">Meta webhook delivery certified</span>
              </div>
            </div>
          </div>
        </article>

        {/* Subtle Divider */}
        <div className="editorial-divider" data-scroll-reveal="divider" aria-hidden="true" />

        {/* -------------------------------------------------------------
            BLOCK 02: WHATSAPP FIRST TOUCH
            ------------------------------------------------------------- */}
        <article className="editorial-story-block" data-scroll-reveal="story">
          <div className="editorial-lead-meta">
            <span className="editorial-index">02</span>
            <span className="editorial-category">WhatsApp Cloud API</span>
          </div>
          <div className="editorial-main-content">
            <h2 className="editorial-statement">
              Connect where 90% of buyers<br />
              <span className="editorial-statement-accent">actually open and reply.</span>
            </h2>
            <p className="editorial-description">
              Cold emails get ignored and phone calls get screened. simplecrm automatically initiates contact via the official Meta WhatsApp Cloud API with a personalized greeting and project brochure within seconds of ad submission, achieving an 89% open rate within the first 60 seconds.
            </p>
            <div className="editorial-highlight-row" data-stagger-group="stats">
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">1.2s</span>
                <span className="editorial-stat-label">Average first-touch delivery</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">89%</span>
                <span className="editorial-stat-label">Read within 60 seconds</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">Official</span>
                <span className="editorial-stat-label">Meta Business verified channel</span>
              </div>
            </div>
          </div>
        </article>

        {/* Subtle Divider */}
        <div className="editorial-divider" data-scroll-reveal="divider" aria-hidden="true" />

        {/* -------------------------------------------------------------
            BLOCK 03: INTELLIGENT DISTRIBUTION & ANDROID APP
            ------------------------------------------------------------- */}
        <article className="editorial-story-block" data-scroll-reveal="story">
          <div className="editorial-lead-meta">
            <span className="editorial-index">03</span>
            <span className="editorial-category">Smart Routing & Mobile</span>
          </div>
          <div className="editorial-main-content">
            <h2 className="editorial-statement">
              Pushed straight to your sales rep’s pocket.<br />
              <span className="editorial-statement-accent">Ready for one-tap calling.</span>
            </h2>
            <p className="editorial-description">
              Never let leads languish in an unassigned queue. simplecrm’s configurable round-robin engine instantly routes each lead to an active sales rep with instant push notifications on their Android app, complete with lead scores and 1-tap dialer calling.
            </p>
            <div className="editorial-highlight-row" data-stagger-group="stats">
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">Instant</span>
                <span className="editorial-stat-label">Android push notifications</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">Equal</span>
                <span className="editorial-stat-label">Round-robin rep allocation</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">1-Tap</span>
                <span className="editorial-stat-label">Native dialer & WhatsApp launch</span>
              </div>
            </div>
          </div>
        </article>

        {/* Subtle Divider */}
        <div className="editorial-divider" data-scroll-reveal="divider" aria-hidden="true" />

        {/* -------------------------------------------------------------
            BLOCK 04: CLOSED-LOOP META CAPI FEEDBACK
            ------------------------------------------------------------- */}
        <article className="editorial-story-block" data-scroll-reveal="story">
          <div className="editorial-lead-meta">
            <span className="editorial-index">04</span>
            <span className="editorial-category">Full-Funnel Feedback</span>
          </div>
          <div className="editorial-main-content">
            <h2 className="editorial-statement">
              Don’t optimize ad spend for clicks.<br />
              <span className="editorial-statement-accent">Train Meta on closed revenue.</span>
            </h2>
            <p className="editorial-description">
              Stop optimizing ad spend purely for cheap form fills. When a deal is marked "Closed Won", simplecrm automatically dispatches authenticated conversion signals back to Meta via the Conversions API (CAPI), training Meta's AI algorithms to target paying buyers instead of tire-kickers.
            </p>
            <div className="editorial-highlight-row" data-stagger-group="stats">
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">CAPI</span>
                <span className="editorial-stat-label">Automated Meta sync on Won</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">4.8x</span>
                <span className="editorial-stat-label">Observed ROAS improvement</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">Zero</span>
                <span className="editorial-stat-label">Manual offline conversion CSVs</span>
              </div>
            </div>
          </div>
        </article>

        {/* Subtle Divider */}
        <div className="editorial-divider" data-scroll-reveal="divider" aria-hidden="true" />

        {/* -------------------------------------------------------------
            BLOCK 05: DATA SECURITY & INFRASTRUCTURE
            ------------------------------------------------------------- */}
        <article className="editorial-story-block" data-scroll-reveal="story">
          <div className="editorial-lead-meta">
            <span className="editorial-index">05</span>
            <span className="editorial-category">Privacy & Architecture</span>
          </div>
          <div className="editorial-main-content">
            <h2 className="editorial-statement">
              Your customer data stays strictly private.<br />
              <span className="editorial-statement-accent">Enterprise-grade security by default.</span>
            </h2>
            <p className="editorial-description">
              Every customer interaction, phone number, and revenue figure is guarded by PostgreSQL Row-Level Security (RLS) policies so sales reps only see their assigned accounts. Automated database snapshots run daily with continuous 7-day retention and cryptographic authentication by default.
            </p>
            <div className="editorial-highlight-row" data-stagger-group="stats">
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">RLS</span>
                <span className="editorial-stat-label">Granular database isolation</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">PBKDF2</span>
                <span className="editorial-stat-label">Cryptographic authentication</span>
              </div>
              <div className="editorial-stat-item">
                <span className="editorial-stat-value">7-Day</span>
                <span className="editorial-stat-label">Continuous automated snapshots</span>
              </div>
            </div>
          </div>
        </article>

      </div>
    </section>
  );
}
