import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Studio from './components/Studio';
import Gallery from './components/Gallery';
import TechStackModal from './components/TechStackModal';
import Footer from './components/Footer';
import { checkHealth } from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('home'); // 'home', 'studio', 'gallery'
  const [backendStatus, setBackendStatus] = useState(null);
  const [isTechModalOpen, setIsTechModalOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState(null);

  useEffect(() => {
    async function loadStatus() {
      const status = await checkHealth();
      setBackendStatus(status);
    }
    loadStatus();
    const interval = setInterval(loadStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectPresetForStudio = (presetId) => {
    setSelectedPresetId(presetId);
    setActiveTab('studio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F6F0] text-[#1A1A1E] selection:bg-[#8B5A2B]/20 selection:text-[#5C3818]">
      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        backendStatus={backendStatus}
        onOpenTechModal={() => setIsTechModalOpen(true)}
      />

      {/* Main Content Pages */}
      <main className="flex-1">
        {activeTab === 'home' && (
          <Hero
            onLaunchStudio={() => {
              setActiveTab('studio');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onExploreGallery={() => {
              setActiveTab('gallery');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onSelectPreset={handleSelectPresetForStudio}
          />
        )}

        {activeTab === 'studio' && (
          <Studio selectedPresetId={selectedPresetId} />
        )}

        {activeTab === 'gallery' && (
          <Gallery onSelectForStudio={handleSelectPresetForStudio} />
        )}
      </main>

      {/* University Tech Documentation Modal */}
      <TechStackModal
        isOpen={isTechModalOpen}
        onClose={() => setIsTechModalOpen(false)}
      />

      {/* Footer */}
      <Footer
        onOpenTechModal={() => setIsTechModalOpen(true)}
        setActiveTab={setActiveTab}
      />
    </div>
  );
}
