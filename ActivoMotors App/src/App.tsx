import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Package, 
  ListOrdered, 
  Users, 
  Settings, 
  Search, 
  Menu, 
  X,
  TrendingUp,
  DollarSign,
  Box
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { sheetsService, InventoryItem } from './services/googleSheetsService';

export default function App() {
  const [activeTab, setActiveTab] = useState('LISTA DE PRECIOS');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const tabs = [
    { id: 'ENTRADA / SALIDA', icon: TrendingUp },
    { id: 'INVENTARIO', icon: Box },
    { id: 'LISTA DE PRECIOS', icon: ListOrdered },
    { id: 'PRODUCTOS', icon: Package },
    { id: 'PEDIDOS', icon: ListOrdered },
    { id: 'CLIENTES', icon: Users },
  ];

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      let data: InventoryItem[] = [];
      if (activeTab === 'LISTA DE PRECIOS') {
        data = await sheetsService.getPriceList();
      } else if (activeTab === 'INVENTARIO') {
        data = await sheetsService.getInventory();
      }
      setInventory(data);
      setLoading(false);
    };
    fetchData();
  }, [activeTab]);

  const filteredInventory = inventory.filter(item => 
    item.descripcion.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.marca.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isPriceList = activeTab === 'LISTA DE PRECIOS';
  const isInventory = activeTab === 'INVENTARIO';

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex font-sans text-[#343A40]">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 80 }}
        className="bg-[#1A1D21] text-white flex flex-col shadow-xl z-20"
      >
        <div className="p-6 flex items-center justify-between border-b border-white/10">
          {isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2"
            >
              <img 
                src="https://storage.googleapis.com/test-prod-content/4976766528859131/1743178495039/input_file_1.png" 
                alt="Activo Motors Logo" 
                className="h-8 w-auto object-contain"
                referrerPolicy="no-referrer"
              />
            </motion.div>
          )}
          {!isSidebarOpen && (
            <img 
              src="https://storage.googleapis.com/test-prod-content/4976766528859131/1743178495039/input_file_1.png" 
              alt="AM" 
              className="h-6 w-6 object-contain"
              referrerPolicy="no-referrer"
            />
          )}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors ml-auto"
          >
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 ${
                activeTab === tab.id 
                  ? 'bg-[#FF6B6B] text-white shadow-lg shadow-[#FF6B6B]/20' 
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <tab.icon size={20} />
              {isSidebarOpen && <span className="font-medium text-sm">{tab.id}</span>}
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-white/10">
          <button className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors">
            <Settings size={20} />
            {isSidebarOpen && <span className="text-sm font-medium">Configuración</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-white border-b border-gray-200 flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-4 flex-1 max-w-xl">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input 
                type="text" 
                placeholder="Buscar por código, marca o descripción..."
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FF6B6B]/20 focus:border-[#FF6B6B] transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Tasa del Día</p>
              <p className="text-sm font-bold text-[#20C997]">Bs 466,60</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-[#FF6B6B]/10 flex items-center justify-center text-[#FF6B6B] font-bold">
              AM
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-[#1A1D21]">{activeTab}</h2>
                <p className="text-gray-500 text-sm mt-1">Gestiona y visualiza los datos de tu inventario en tiempo real.</p>
              </div>
              <button className="bg-[#1A1D21] text-white px-5 py-2.5 rounded-xl font-medium hover:bg-[#2D3339] transition-colors shadow-sm">
                Exportar Datos
              </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: 'Total Productos', value: inventory.length, icon: Box, color: 'blue' },
                { label: 'Valor Inventario ($)', value: '$45,230', icon: DollarSign, color: 'green' },
                { label: 'Items Activos', value: inventory.filter(i => i.activo !== false).length, icon: TrendingUp, color: 'red' },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
                  <div className={`p-3 rounded-xl bg-gray-50 text-gray-600`}>
                    <stat.icon size={24} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{stat.label}</p>
                    <p className="text-2xl font-bold mt-0.5">{stat.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Table Container */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50 border-b border-gray-100">
                      <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">ID</th>
                      <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">Código</th>
                      <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">Marca</th>
                      <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">Categoría</th>
                      <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">Descripción</th>
                      <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest">Fabricante</th>
                      {isPriceList && (
                        <>
                          <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-right">Precio $</th>
                          <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-right">Precio Bs</th>
                          <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-right">P. Seleccionado</th>
                        </>
                      )}
                      {isInventory && (
                        <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-right">Stock</th>
                      )}
                      <th className="px-6 py-4 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {loading ? (
                      <tr>
                        <td colSpan={12} className="px-6 py-20 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-4 border-[#FF6B6B] border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-gray-500 font-medium">Cargando datos desde Google Sheets...</p>
                          </div>
                        </td>
                      </tr>
                    ) : filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-6 py-20 text-center text-gray-400 font-medium">
                          No se encontraron resultados. Verifica tu API Key y que el ID de la hoja sea correcto.
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50/50 transition-colors group">
                          <td className="px-6 py-4 text-sm font-mono text-gray-400">{item.id}</td>
                          <td className="px-6 py-4 text-sm font-bold text-[#1A1D21]">{item.codigo}</td>
                          <td className="px-6 py-4">
                            <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold uppercase">
                              {item.marca}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">{item.categoria}</td>
                          <td className="px-6 py-4 text-sm font-medium text-gray-700 max-w-xs truncate">
                            {item.descripcion}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">{item.fabricante}</td>
                          
                          {isPriceList && (
                            <>
                              <td className="px-6 py-4 text-sm font-bold text-right text-[#1A1D21]">
                                ${item.precioUsd?.toFixed(2)}
                              </td>
                              <td className="px-6 py-4 text-sm font-bold text-right text-[#20C997]">
                                Bs {item.precioBs?.toLocaleString()}
                              </td>
                              <td className="px-6 py-4 text-sm font-bold text-right text-[#FF6B6B]">
                                ${item.precioSeleccionado?.toFixed(2) || '0.00'}
                              </td>
                            </>
                          )}

                          {isInventory && (
                            <td className="px-6 py-4 text-sm font-bold text-right text-[#1A1D21]">
                              <span className={`px-3 py-1 rounded-full ${item.stock && item.stock > 5 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {item.stock}
                              </span>
                            </td>
                          )}

                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex h-2 w-2 rounded-full ${item.activo !== false ? 'bg-[#20C997]' : 'bg-gray-300'}`}></span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
