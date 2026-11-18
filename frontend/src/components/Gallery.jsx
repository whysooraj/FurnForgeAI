import React, { useState, useEffect } from 'react';
import { 
  Download, Eye, Trash2, Sparkles, Filter, Calendar, 
  Layers, ArrowLeftRight, Check, X, RefreshCw, Box, Camera 
} from 'lucide-react';
import { getGallery, deleteGalleryItem } from '../services/api';
import { CATEGORIES } from '../utils/presets';
import Model3DViewer from './Model3DViewer';
import ViewInRoomModal from './ViewInRoomModal';

export default function Gallery({ onSelectForStudio }) {
  const [items, setItems] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isLoading, setIsLoading] = useState(true);
  const [activeModalItem, setActiveModalItem] = useState(null);
  const [modalTab, setModalTab] = useState('photoreal'); // 'photoreal' | 'compare' | '3d'
  const [roomViewItem, setRoomViewItem] = useState(null);

  const fetchItems = async () => {
    try {
      setIsLoading(true);
      const res = await getGallery(selectedCategory);
      setItems(res.items || []);
    } catch (err) {
      console.error('Error fetching gallery:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [selectedCategory]);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Delete this design from gallery?')) return;
    try {
      await deleteGalleryItem(id);
      setItems(items.filter((item) => item.id !== id));
      if (activeModalItem?.id === id) setActiveModalItem(null);
    } catch (err) {
      console.error('Failed to delete item:', err);
    }
  };

  const handleDownload = (e, url, name) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = url;
    link.download = name || 'furnforge-design.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in duration-300">
      {/* Gallery Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#E8E2D5] pb-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#8B5A2B]">Design Repository</span>
          <h2 className="text-3xl font-bold text-[#1A1A1E]">Furniture Catalog</h2>
          <p className="text-xs text-[#78716C] mt-1">
            Browse, inspect, and download previously forged photorealistic pieces.
          </p>
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap items-center gap-1.5 bg-[#F5F2EB] p-1.5 rounded-xl border border-[#E4DEC3]/70">
          <button
            onClick={() => setSelectedCategory('All')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              selectedCategory === 'All'
                ? 'bg-white text-[#1A1A1E] shadow-xs'
                : 'text-[#78716C] hover:text-[#1A1A1E]'
            }`}
          >
            All Items
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedCategory === c.id
                  ? 'bg-white text-[#1A1A1E] shadow-xs'
                  : 'text-[#78716C] hover:text-[#1A1A1E]'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Creations */}
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <RefreshCw className="w-8 h-8 text-[#8B5A2B] animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-[#E8E2D5] space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-[#F5F2EB] flex items-center justify-center text-[#9E978B] mx-auto">
            <Layers className="w-7 h-7" />
          </div>
          <h4 className="text-lg font-bold text-[#1A1A1E]">No Designs in this Category</h4>
          <p className="text-xs text-[#78716C] max-w-sm mx-auto">
            Try choosing a different filter or forge your first furniture design in the AI Studio!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => {
                setActiveModalItem(item);
                setModalTab('photoreal');
              }}
              className="group bg-white rounded-2xl overflow-hidden border border-[#E8E2D5] shadow-xs hover:shadow-lg hover:border-[#8B5A2B]/40 transition-all cursor-pointer flex flex-col"
            >
              {/* Image Preview with Hover Overlay */}
              <div className="relative aspect-square w-full bg-[#FAF8F5] overflow-hidden flex items-center justify-center">
                <img
                  src={item.result_image_url}
                  alt={item.category}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />

                {/* Category badge */}
                <span className="absolute top-2.5 left-2.5 bg-black/70 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                  {item.category}
                </span>

                {/* Action Buttons overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveModalItem(item);
                      setModalTab('photoreal');
                    }}
                    className="w-9 h-9 rounded-full bg-white text-[#1A1A1E] flex items-center justify-center hover:scale-110 transition-transform shadow-md"
                    title="View Details"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => handleDownload(e, item.result_image_url, `${item.category.toLowerCase()}-${item.id}.png`)}
                    className="w-9 h-9 rounded-full bg-white text-[#1A1A1E] flex items-center justify-center hover:scale-110 transition-transform shadow-md"
                    title="Download 8K"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, item.id)}
                    className="w-9 h-9 rounded-full bg-white text-rose-600 flex items-center justify-center hover:scale-110 transition-transform shadow-md"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Card Meta Content */}
              <div className="p-4 flex-1 flex flex-col justify-between space-y-2">
                <div>
                  <h4 className="font-bold text-sm text-[#1A1A1E] truncate">
                    {item.style} {item.color} {item.category}
                  </h4>
                  <p className="text-xs text-[#78716C] mt-0.5">
                    {item.material} • {item.finish}
                  </p>
                </div>

                <div className="flex items-center justify-between text-[10px] text-[#999] pt-2 border-t border-[#F5F2EB]">
                  <span>{item.created_at ? item.created_at.split('T')[0] : 'Showcase'}</span>
                  <span className="font-semibold text-[#8B5A2B]">{item.pipeline_mode ? 'Verified AI' : 'Design'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail & Compare Modal */}
      {activeModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-[#E8E2D5] shadow-2xl p-6 sm:p-8 space-y-6">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-[#F0ECE1]">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#8B5A2B]">
                  Design Artifact Details
                </span>
                <h3 className="text-xl font-bold text-[#1A1A1E]">
                  {activeModalItem.style} {activeModalItem.category}
                </h3>
              </div>
              <button
                onClick={() => setActiveModalItem(null)}
                className="w-8 h-8 rounded-full bg-[#F5F2EB] hover:bg-[#EAE4D7] flex items-center justify-center text-[#555]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* View Mode Toggle (3 Tabs) */}
            <div className="flex items-center justify-between gap-1 bg-[#F5F2EB] p-1 rounded-xl text-xs">
              <button
                onClick={() => setModalTab('photoreal')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all ${
                  modalTab === 'photoreal' ? 'bg-white text-[#1A1A1E] shadow-xs font-bold' : 'text-[#78716C] hover:text-[#1A1A1E]'
                }`}
              >
                Photoreal Render
              </button>
              <button
                onClick={() => setModalTab('compare')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all ${
                  modalTab === 'compare' ? 'bg-[#1A1A1E] text-white shadow-xs font-bold' : 'text-[#78716C] hover:text-[#1A1A1E]'
                }`}
              >
                Sketch &amp; Edge Map
              </button>
              <button
                onClick={() => setModalTab('3d')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1.5 ${
                  modalTab === '3d' ? 'bg-[#8B5A2B] text-white shadow-xs font-bold' : 'text-[#78716C] hover:text-[#1A1A1E]'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                <span>Interactive 3D Model</span>
              </button>
            </div>

            {/* Tab Content */}
            {modalTab === 'photoreal' && (
              <div className="aspect-square max-h-[440px] mx-auto rounded-2xl overflow-hidden border border-[#E8E2D5] bg-[#FAF8F5] flex items-center justify-center p-2">
                <img
                  src={activeModalItem.result_image_url}
                  alt={activeModalItem.category}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )}

            {modalTab === 'compare' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="aspect-square rounded-xl overflow-hidden border border-[#E8E2D5] bg-white p-2 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-bold text-[#78716C] mb-1">Sketch</span>
                  <img src={activeModalItem.original_image_url} alt="Sketch" className="max-h-[85%] object-contain" />
                </div>
                <div className="aspect-square rounded-xl overflow-hidden border border-[#1A1A1E] bg-black p-2 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-bold text-white mb-1">ControlNet Canny</span>
                  <img src={activeModalItem.preprocessed_edge_url} alt="Canny" className="max-h-[85%] object-contain filter invert" />
                </div>
                <div className="aspect-square rounded-xl overflow-hidden border border-[#8B5A2B] bg-[#FAF8F5] p-2 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-bold text-[#8B5A2B] mb-1">8K Render</span>
                  <img src={activeModalItem.result_image_url} alt="Render" className="max-h-[85%] object-contain" />
                </div>
              </div>
            )}

            {modalTab === '3d' && (
              <Model3DViewer
                key={activeModalItem.id}
                item={activeModalItem}
                onViewInRoom={() => setRoomViewItem(activeModalItem)}
                onModelUpdated={(genId, generatedModel) => {
                  setActiveModalItem((prev) => (prev && prev.id === genId ? { ...prev, model_3d: generatedModel } : prev));
                  setItems((prev) => prev.map((it) => (it.id === genId ? { ...it, model_3d: generatedModel } : it)));
                }}
              />
            )}

            {/* Specs & Prompt */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#ECE6D8]">
                <span className="text-[10px] text-[#78716C] block">Material</span>
                <span className="font-bold text-[#1A1A1E]">{activeModalItem.material}</span>
              </div>
              <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#ECE6D8]">
                <span className="text-[10px] text-[#78716C] block">Color</span>
                <span className="font-bold text-[#1A1A1E]">{activeModalItem.color}</span>
              </div>
              <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#ECE6D8]">
                <span className="text-[10px] text-[#78716C] block">Style</span>
                <span className="font-bold text-[#1A1A1E]">{activeModalItem.style}</span>
              </div>
              <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#ECE6D8]">
                <span className="text-[10px] text-[#78716C] block">Finish</span>
                <span className="font-bold text-[#1A1A1E]">{activeModalItem.finish}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-bold text-[#1A1A1E]">Prompt Used</span>
              <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#ECE6D8] text-[11px] text-[#555] font-mono leading-relaxed">
                {activeModalItem.prompt}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={(e) => handleDelete(e, activeModalItem.id)}
                className="px-4 py-2.5 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Design</span>
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setRoomViewItem(activeModalItem)}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#8B5A2B] to-[#5C3818] hover:from-[#724821] hover:to-[#4A2D12] text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-xs"
                >
                  <Camera className="w-3.5 h-3.5 text-amber-200" />
                  <span>View in Your Room</span>
                </button>
                <button
                  onClick={(e) => handleDownload(e, activeModalItem.result_image_url, `furnforge-${activeModalItem.category.toLowerCase()}.png`)}
                  className="px-5 py-2.5 rounded-xl bg-[#1A1A1E] hover:bg-[#2C2C32] text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download High-Res</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ViewInRoomModal
        isOpen={Boolean(roomViewItem)}
        onClose={() => setRoomViewItem(null)}
        item={roomViewItem}
        onModelUpdated={(genId, generatedModel) => {
          setRoomViewItem((prev) => (prev && prev.id === genId ? { ...prev, model_3d: generatedModel } : prev));
          setActiveModalItem((prev) => (prev && prev.id === genId ? { ...prev, model_3d: generatedModel } : prev));
          setItems((prev) => prev.map((it) => (it.id === genId ? { ...it, model_3d: generatedModel } : it)));
        }}
      />
    </section>
  );
}

