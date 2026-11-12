import { useEffect } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const SCROLL_TIMELINE_SUPPORT = '(animation-timeline: view()) and (animation-range: entry)';
const SIBLING_INDEX_SUPPORT = 'animation-delay: calc(sibling-index() * 0.1s)';

/**
 * Hydrates scroll-reveal fallbacks and sibling stagger indices inside a container
 * only when native CSS ViewTimeline or sibling-index() is unsupported and motion is enabled.
 */
export function useScrollReveal(containerRef) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root || typeof window === 'undefined') return undefined;

    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      return undefined;
    }

    // Populate --sibling-index CSS custom property only if sibling-index() isn't supported
    if (typeof CSS === 'undefined' || !CSS.supports(SIBLING_INDEX_SUPPORT)) {
      const staggerGroups = root.querySelectorAll('[data-stagger-group]');
      staggerGroups.forEach((group) => {
        Array.from(group.children).forEach((child, idx) => {
          child.style.setProperty('--sibling-index', String(idx + 1));
        });
      });
    }

    const supportsScrollTimeline =
      typeof CSS !== 'undefined' && CSS.supports(SCROLL_TIMELINE_SUPPORT);

    if (supportsScrollTimeline) {
      return undefined;
    }

    const targets = Array.from(root.querySelectorAll('[data-scroll-reveal]'));
    if (targets.length === 0) return undefined;

    const viewportH = window.innerHeight || 900;
    const pending = [];

    targets.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < viewportH * 0.94) {
        el.setAttribute('data-revealed', 'true');
      } else {
        el.setAttribute('data-reveal-fallback', 'pending');
        pending.push(el);
      }
    });

    if (pending.length === 0 || typeof IntersectionObserver === 'undefined') {
      pending.forEach((el) => el.setAttribute('data-revealed', 'true'));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.removeAttribute('data-reveal-fallback');
            entry.target.setAttribute('data-revealed', 'true');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -4% 0px' }
    );

    pending.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [containerRef]);
}

/**
 * Tracks cursor position relative to a dark CTA container with cached ResizeObserver bounds,
 * driving CSS custom properties (--mouse-x / --mouse-y) for zero-rerender radial spotlights.
 */
export function useSpotlightSurface(surfaceRef) {
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || typeof window === 'undefined') return undefined;

    if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
      return undefined;
    }

    let rect = surface.getBoundingClientRect();

    const updateRect = () => {
      rect = surface.getBoundingClientRect();
    };

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateRect);
      resizeObserver.observe(surface);
    }

    const handlePointerMove = (e) => {
      if (!rect.width || !rect.height) updateRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      surface.style.setProperty('--mouse-x', `${x.toFixed(2)}%`);
      surface.style.setProperty('--mouse-y', `${y.toFixed(2)}%`);
    };

    surface.addEventListener('pointerenter', updateRect, { passive: true });
    surface.addEventListener('pointermove', handlePointerMove, { passive: true });

    return () => {
      surface.removeEventListener('pointerenter', updateRect);
      surface.removeEventListener('pointermove', handlePointerMove);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [surfaceRef]);
}

