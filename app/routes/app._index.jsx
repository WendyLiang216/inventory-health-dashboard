import { useLoaderData, Form } from "react-router";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = { lowStockThreshold: 5, overStockThreshold: 100 };
  }

  const response = await admin.graphql(`#graphql
    query { products(first: 50) { edges { node { 
      id title category { name }
      variants(first: 10) { edges { node { 
        id sku price inventoryQuantity 
        inventoryItem { id unitCost { amount } }
      }}}
    }}}}`);

  const { data } = await response.json();
  const products = data.products.edges;

  const lowT = settings.lowStockThreshold;
  const overT = settings.overStockThreshold;

  let totalValue = 0, lowStock = 0, overStock = 0, noSales = 0;
  const exceptions = [];

  products.forEach(({ node: p }) => {
    p.variants.edges.forEach(({ node: v }) => {
      const qty = v.inventoryQuantity || 0;
      const price = parseFloat(v.price) || 0;
      const cost = parseFloat(v.inventoryItem?.unitCost?.amount) || price * 0.6;
      const value = qty * cost;
      totalValue += value;

      let status = "Healthy";
      if (qty <= lowT && qty > 0) { status = "Low Stock"; lowStock++; }
      else if (qty >= overT) { status = "Overstock"; overStock++; }
      else if (qty === 0) { status = "No Sales"; noSales++; }

      if (status !== "Healthy") {
        exceptions.push({
          status, item: p.title, sku: v.sku || "-",
          category: p.category?.name || "-", qty, value: value.toFixed(2)
        });
      }
    });
  });

  return Response.json({
    totalValue: totalValue.toFixed(2),
    lowStock, overStock, noSales,
    totalSkus: products.length * 2,
    exceptions,
    settings: {
      lowStockThreshold: lowT,
      overStockThreshold: overT
    }
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const lowStock = parseInt(formData.get("lowStockThreshold")) || 5;
  const overStock = parseInt(formData.get("overStockThreshold")) || 100;

  await prisma.shopSettings.upsert({
    where: { shop: session.shop },
    update: {
      lowStockThreshold: lowStock,
      overStockThreshold: overStock
    },
    create: {
      shop: session.shop,
      lowStockThreshold: lowStock,
      overStockThreshold: overStock
    },
  });

  return Response.json({ success: true });
};

export default function Dashboard() {
  const d = useLoaderData();
  const settings = d.settings;

  return (
    <div style={{ padding: "20px" }}>
      <h1>Inventory Health Dashboard</h1>

      <div style={{ background: "#f6f6f7", padding: "20px", borderRadius: "8px", marginBottom: "20px" }}>
        <h3 style={{ marginTop: 0, marginBottom: "15px" }}>Inventory Settings</h3>
        <Form method="post" style={{ display: "flex", gap: "20px", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "#666", marginBottom: "4px" }}>
              Low Stock Threshold
            </label>
            <input
              type="number"
              name="lowStockThreshold"
              defaultValue={settings.lowStockThreshold}
              min="1"
              style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc", width: "120px" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "#666", marginBottom: "4px" }}>
              Overstock Threshold
            </label>
            <input
              type="number"
              name="overStockThreshold"
              defaultValue={settings.overStockThreshold}
              min="1"
              style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc", width: "120px" }}
            />
          </div>
          <button
            type="submit"
            style={{
              padding: "8px 20px",
              background: "#008060",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold"
            }}
          >
            Save Settings
          </button>
        </Form>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "20px", margin: "20px 0" }}>
        <div style={{ background: "#f6f6f7", padding: "20px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#666" }}>Total Value</div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#008060" }}>${parseInt(d.totalValue).toLocaleString()}</div>
        </div>
        <div style={{ background: "#f6f6f7", padding: "20px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#666" }}>Low Stock (≤{settings.lowStockThreshold})</div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#d72c0d" }}>{d.lowStock}</div>
        </div>
        <div style={{ background: "#f6f6f7", padding: "20px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#666" }}>Overstock (≥{settings.overStockThreshold})</div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#c2410c" }}>{d.overStock}</div>
        </div>
        <div style={{ background: "#f6f6f7", padding: "20px", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", color: "#666" }}>No Sales</div>
          <div style={{ fontSize: "28px", fontWeight: "bold" }}>{d.noSales}</div>
        </div>
      </div>

      <h2>Inventory Exception List</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ccc", textAlign: "left" }}>
            <th style={{ padding: "10px" }}>Status</th>
            <th style={{ padding: "10px" }}>Item</th>
            <th style={{ padding: "10px" }}>Category</th>
            <th style={{ padding: "10px" }}>SKU</th>
            <th style={{ padding: "10px" }}>Qty</th>
            <th style={{ padding: "10px" }}>Value</th>
          </tr>
        </thead>
        <tbody>
          {d.exceptions.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "10px" }}>
                <span style={{
                  background: row.status === "Low Stock" ? "#ffebee" : row.status === "Overstock" ? "#fff3e0" : "#f5f5f5",
                  color: row.status === "Low Stock" ? "#d32f2f" : row.status === "Overstock" ? "#f57c00" : "#666",
                  padding: "4px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold"
                }}>{row.status}</span>
              </td>
              <td style={{ padding: "10px" }}>{row.item}</td>
              <td style={{ padding: "10px" }}>{row.category}</td>
              <td style={{ padding: "10px" }}>{row.sku}</td>
              <td style={{ padding: "10px" }}>{row.qty}</td>
              <td style={{ padding: "10px" }}>${row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}