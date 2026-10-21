import React, { useState, useEffect, useRef } from 'react';
import LaterOnSkeleton from './LaterOnSkeleton';

export default function LaterOnView({ prefillData }) {
  const iframeRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Keep initialSrc stable so updating prefillData never triggers a browser iframe reload
  const [initialSrc] = useState(() => {
    let activeData = prefillData;
    try {
      const raw = sessionStorage.getItem('lateron_prefill');
      if (raw) activeData = JSON.parse(raw);
    } catch (e) {}

    const query = new URLSearchParams({
      embed: 'crm',
      embedded: 'true',
      hideServices: 'instagram,telegram,support'
    });

    if (activeData?.channel) {
      query.set('channel', activeData.channel);
      if (activeData.channel === 'email') {
        if (activeData.email) query.set('email', activeData.email);
        if (activeData.subject) query.set('subject', activeData.subject);
      } else {
        if (activeData.phone) query.set('phone', activeData.phone);
      }
      if (activeData.name) query.set('name', activeData.name);
      if (activeData.message) query.set('message', activeData.message);
    }

    return `https://lateron.capoasis.com/dashboard?${query.toString()}`;
  });

  // Transmit prefill data into LaterOn iframe via postMessage
  const transmitPrefill = (dataToSend) => {
    let payload = dataToSend || prefillData;
    if (!payload) {
      const rawData = sessionStorage.getItem('lateron_prefill');
      if (rawData) {
        try {
          payload = JSON.parse(rawData);
        } catch (e) {
          console.error('Failed to parse lateron_prefill', e);
        }
      }
    }
    if (!payload) return;

    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'LATERON_PREFILL',
        ...payload
      }, '*');
      sessionStorage.removeItem('lateron_prefill');
    }
  };

  // When prefillData updates while iframe is already alive:
  useEffect(() => {
    if (prefillData && isLoaded) {
      const timer = setTimeout(() => {
        transmitPrefill(prefillData);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [prefillData, isLoaded]);

  // Safety fallback in case iframe onLoad is delayed or interrupted
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoaded(true);
    }, 10000);

    return () => clearTimeout(timer);
  }, []);

  const handleIframeLoad = () => {
    setIsLoaded(true);
    setTimeout(() => {
      transmitPrefill();
    }, 200);
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 'calc(100vh - 64px)',
        overflow: 'hidden',
        background: '#ffffff'
      }}
    >
      {/* Matching Shimmer Skeleton Loader on initial mount */}
      {!isLoaded && <LaterOnSkeleton isLoaded={isLoaded} />}

      {/* Embedded LaterOn Dashboard - Persistently kept alive */}
      <iframe
        ref={iframeRef}
        id="lateron-iframe"
        src={initialSrc}
        title="LaterOn Automation"
        onLoad={handleIframeLoad}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          opacity: isLoaded ? 1 : 0,
          transition: 'opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        allow="clipboard-read; clipboard-write; camera; microphone;"
      />
    </div>
  );
}
