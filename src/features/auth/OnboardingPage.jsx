import React from 'react';

export default function OnboardingPage({ onGoToDashboard }) {
  const seen = localStorage.getItem('onboarding_seen');
  if (seen) { onGoToDashboard?.(); return null; }

  return (
    <div style={{ minHeight: '100dvh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 700, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 8, background: '#4CAF50', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', fontWeight: 700, marginBottom: 16 }}>S</div>
        <div style={{ fontSize: 24, fontWeight: 600, color: '#333', marginBottom: 8 }}>Welcome to ScopeTakeoff!</div>
        <div style={{ fontSize: 14, color: '#666', marginBottom: 32 }}>Your 7-day free trial has started. Here's how to get going:</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 32 }}>
          {[
            { icon: '📐', title: 'Upload Your First Plans', desc: 'Create a project and upload construction PDFs', btn: 'Create Project →' },
            { icon: '📚', title: 'Set Up Your Library', desc: 'Customize your item prices and categories', btn: 'Open Library →' },
            { icon: '👥', title: 'Invite Your Team', desc: 'Add estimators to collaborate on bids', btn: 'Invite →' },
          ].map((card, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{card.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#333', marginBottom: 6 }}>{card.title}</div>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 16, lineHeight: 1.5 }}>{card.desc}</div>
              <button onClick={() => { localStorage.setItem('onboarding_seen', 'true'); onGoToDashboard?.(); }}
                style={{ background: '#4CAF50', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                {card.btn}
              </button>
            </div>
          ))}
        </div>

        <a href="#" onClick={e => { e.preventDefault(); localStorage.setItem('onboarding_seen', 'true'); onGoToDashboard?.(); }}
          style={{ color: '#999', fontSize: 13, textDecoration: 'none' }}>
          Skip — go to dashboard →
        </a>
      </div>
    </div>
  );
}
