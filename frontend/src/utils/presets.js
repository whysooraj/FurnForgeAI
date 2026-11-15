export const CATEGORIES = [
  { id: 'Chair', name: 'Chair', icon: 'Armchair', description: 'Armchairs, lounge chairs & dining seating' },
  { id: 'Table', name: 'Table', icon: 'Table', description: 'Dining, coffee, console & sculptured tables' },
  { id: 'Sofa', name: 'Sofa', icon: 'Sofa', description: 'Curved 3-seaters, sectionals & minimalist couches' },
  { id: 'Bed', name: 'Bed', icon: 'Bed', description: 'Platform frames & upholstered headboards' },
  { id: 'Cabinet', name: 'Cabinet', icon: 'Archive', description: 'Credenzas, sideboards & minimalist storage' }
];

export const MATERIALS = [
  { 
    id: 'Wood', 
    name: 'Natural Wood', 
    subtypes: ['Solid Oak', 'American Walnut', 'Teak Wood', 'Bleached Ash'],
    icon: 'Trees',
    desc: 'Organic wood grain, warm tactile timber joinery'
  },
  { 
    id: 'Metal', 
    name: 'Architectural Metal', 
    subtypes: ['Polished Brass', 'Matte Black Steel', 'Brushed Aluminum', 'Satin Nickel'],
    icon: 'Hammer',
    desc: 'Precision weld lines, anisotropic reflections'
  },
  { 
    id: 'Glass', 
    name: 'Structural Glass', 
    subtypes: ['Ultra-Clear Float Glass', 'Frosted Acid-Etched', 'Fluted Reeded Glass'],
    icon: 'Sparkles',
    desc: 'Prismatic optical refraction and specular highlights'
  },
  { 
    id: 'Leather', 
    name: 'Italian Leather', 
    subtypes: ['Full-Grain Aniline', 'Vintage Cognac Saddle', 'Velvety Nubuck'],
    icon: 'Shield',
    desc: 'Supple pebble grain with handcrafted saddle stitching'
  },
  { 
    id: 'Fabric', 
    name: 'Designer Textile', 
    subtypes: ['Textured Cream Bouclé', 'Belgian Natural Linen', 'Plush Silk Velvet'],
    icon: 'Feather',
    desc: 'Rich tactile weave and organic ambient soft shading'
  }
];

export const COLORS = [
  { name: 'Warm Walnut', hex: '#523826', tag: 'Wood Tone' },
  { name: 'Charcoal Gray', hex: '#2C2D30', tag: 'Modern Neutral' },
  { name: 'Deep Emerald', hex: '#1E3F2B', tag: 'Luxury Jewel' },
  { name: 'Cognac Brown', hex: '#8B4513', tag: 'Warm Leather' },
  { name: 'Cream Boucle', hex: '#EAE4D9', tag: 'Scandinavian' },
  { name: 'Matte Black', hex: '#161618', tag: 'Industrial' },
  { name: 'Champagne Gold', hex: '#D4AF37', tag: 'Luxury Accent' },
  { name: 'Navy Blue', hex: '#1B263B', tag: 'Contemporary' },
  { name: 'Terracotta', hex: '#C86446', tag: 'Warm Earth' },
  { name: 'Scandinavian Birch', hex: '#D8CCA8', tag: 'Nordic Wood' },
  { name: 'Sage Green', hex: '#82917F', tag: 'Serene Botanical' },
  { name: 'White', hex: '#F5F5F7', tag: 'Clean Architectural' }
];

export const STYLES = [
  { id: 'Modern', name: 'Modern', tag: 'Contemporary & Organic lines' },
  { id: 'Minimalist', name: 'Minimalist', tag: 'Japandi & Zen essence' },
  { id: 'Traditional', name: 'Traditional', tag: 'Heritage craftsmanship' },
  { id: 'Luxury', name: 'Luxury Haute Couture', tag: 'Milan showcase finish' },
  { id: 'Scandinavian', name: 'Scandinavian', tag: 'Nordic light & timber' },
  { id: 'Industrial', name: 'Industrial Loft', tag: 'Raw metal & tactile wood' }
];

export const FINISHES = [
  { id: 'Matte', name: 'Matte', desc: 'Diffused reflection with soft velvety surface' },
  { id: 'Glossy', name: 'Glossy', desc: 'High-specular reflections and lacquered luster' },
  { id: 'Polished', name: 'Polished', desc: 'Hand-buffed artisanal sheen and smooth clarity' },
  { id: 'Brushed', name: 'Brushed', desc: 'Linear anisotropic micro-texture grain' }
];

export const SAMPLE_SKETCHES = [
  {
    id: 'chair',
    name: 'Mid-Century Lounge Chair',
    category: 'Chair',
    material: 'Wood',
    color: 'Warm Walnut',
    style: 'Modern',
    finish: 'Matte',
    url: '/sample_sketches/chair_sketch.png'
  },
  {
    id: 'sofa',
    name: 'Curved Minimalist 3-Seater',
    category: 'Sofa',
    material: 'Fabric',
    color: 'Cream Boucle',
    style: 'Minimalist',
    finish: 'Brushed',
    url: '/sample_sketches/sofa_sketch.png'
  },
  {
    id: 'table',
    name: 'Sculptural Oval Dining Table',
    category: 'Table',
    material: 'Metal',
    color: 'Champagne Gold',
    style: 'Luxury',
    finish: 'Polished',
    url: '/sample_sketches/table_sketch.png'
  },
  {
    id: 'bed',
    name: 'Channeled Platform Bed',
    category: 'Bed',
    material: 'Leather',
    color: 'Cognac Brown',
    style: 'Modern',
    finish: 'Matte',
    url: '/sample_sketches/bed_sketch.png'
  },
  {
    id: 'cabinet',
    name: 'Nordic Fluted Credenza',
    category: 'Cabinet',
    material: 'Wood',
    color: 'Matte Black',
    style: 'Scandinavian',
    finish: 'Matte',
    url: '/sample_sketches/cabinet_sketch.png'
  }
];

