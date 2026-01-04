'use client';

import { useState, useEffect, useRef } from 'react';
import DevToolsPanel from './DevToolsPanel';

interface HomeContentClientProps {
  children: React.ReactNode;
}

/**
 * Client wrapper for Home content that manages dev panel expanded state
 * and sets data-dev-expanded attribute on the home-content container only
 */
export default function HomeContentClient({ children }: HomeContentClientProps) {
  const [isDevPanelExpanded, setIsDevPanelExpanded] = useState(false);
  const homeContentRef = useRef<HTMLDivElement | null>(null);
  const devToolsSectionRef = useRef<HTMLDivElement | null>(null);

  // Update data-attribute when dev panel state changes (only on .page-content.home-content)
  useEffect(() => {
    const contentElement = homeContentRef.current;
    if (!contentElement) return;
    
    if (isDevPanelExpanded) {
      contentElement.setAttribute('data-dev-expanded', 'true');
      
      // Auto-scroll to dev panel when expanded
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const panelElement = devToolsSectionRef.current;
          if (panelElement && contentElement) {
            // Scroll the panel into view within the scroll container
            panelElement.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'end',
              inline: 'nearest'
            });
          }
        });
      });
    } else {
      contentElement.removeAttribute('data-dev-expanded');
      // Reset scroll position to top when panel collapses
      if (contentElement) {
        contentElement.scrollTop = 0;
      }
    }
    
    // Cleanup: remove attribute on unmount
    return () => {
      if (contentElement) {
        contentElement.removeAttribute('data-dev-expanded');
      }
    };
  }, [isDevPanelExpanded]);

  return (
    <>
      <div 
        ref={homeContentRef}
        className="page-content home-content"
      >
        {children}
        
        {/* Dev Tools Panel - только в development режиме */}
        {process.env.NODE_ENV !== 'production' && (
          <div ref={devToolsSectionRef} className="dev-tools-section">
            <DevToolsPanel onExpandedChange={setIsDevPanelExpanded} />
          </div>
        )}
      </div>
    </>
  );
}

