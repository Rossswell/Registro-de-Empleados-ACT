import { GoogleGenAI } from "@google/genai";

export interface InventoryItem {
  id: string;
  codigo: string;
  marca: string;
  categoria: string;
  descripcion: string;
  fabricante: string;
  precioUsd?: number;
  precioBs?: number;
  precioSeleccionado?: number;
  activo?: boolean;
  stock?: number;
}

export class GoogleSheetsService {
  private apiKey: string;
  private spreadsheetId: string;

  constructor() {
    this.apiKey = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY || "";
    this.spreadsheetId = import.meta.env.VITE_SPREADSHEET_ID || "";
  }

  async getPriceList(): Promise<InventoryItem[]> {
    if (!this.apiKey || !this.spreadsheetId) return [];

    try {
      const range = "'LISTA DE PRECIOS'!A3:M500"; 
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?key=${this.apiKey}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (!data.values) return [];

      return data.values
        .filter((row: any[]) => row[1])
        .map((row: any[], index: number) => ({
          id: row[0] || `row-${index}`,
          codigo: row[1] || "",
          marca: row[2] || "",
          categoria: row[3] || "",
          descripcion: row[4] || "",
          fabricante: row[5] || "",
          precioUsd: parseFloat((row[6] || "0").replace("$", "").replace(",", "")) || 0,
          precioBs: parseFloat((row[7] || "0").replace("Bs", "").replace(".", "").replace(",", ".")) || 0,
          precioSeleccionado: parseFloat((row[11] || "0").replace("$", "").replace(",", "")) || 0,
          activo: row[12] === "TRUE" || row[12] === "checked" || row[12] === "TRUE",
        }));
    } catch (error) {
      console.error("Error fetching Price List:", error);
      return [];
    }
  }

  async getInventory(): Promise<InventoryItem[]> {
    if (!this.apiKey || !this.spreadsheetId) return [];

    try {
      const range = "'INVENTARIO'!A3:G500"; 
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?key=${this.apiKey}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (!data.values) return [];

      return data.values
        .filter((row: any[]) => row[1])
        .map((row: any[], index: number) => ({
          id: row[0] || `row-${index}`,
          codigo: row[1] || "",
          marca: row[2] || "",
          categoria: row[3] || "",
          descripcion: row[4] || "",
          fabricante: row[5] || "",
          stock: parseInt(row[6] || "0") || 0,
        }));
    } catch (error) {
      console.error("Error fetching Inventory:", error);
      return [];
    }
  }
}

export const sheetsService = new GoogleSheetsService();
