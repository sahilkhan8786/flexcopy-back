import express from "express";
import axios from "axios";
import xlsx from "xlsx";
import path from "path";

const router = express.Router();
let ids2 = [];
import { fileURLToPath } from 'url';


// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the Excel file path
const excelFilePath = path.resolve(__dirname, 'dev-data', 'sku_names.xlsx');// Replace with your Excel file path
const workbook = xlsx.readFile(excelFilePath);
const sheetName = workbook.SheetNames[0];
const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

// Create SKU to ItemName mapping
const skuToItemMap = sheetData.reduce((map, row) => {
  map[row.SKU] = row.ITEMS; // Adjust column names as per your Excel sheet
  return map;
}, {});

// Function to remove duplicates based on a unique identifier (e.g., order ID)
const removeDuplicates = (records) => {
  return Array.from(new Set(records.map(a => a.id)))
    .map(id => records.find(a => a.id === id));
};

// Function to fetch order data between dates
async function fetchOrderData(date1, date2, token) {
  let records = [];
  await axios.get(
    `https://api.mercadolibre.com/orders/search?seller=51940259&order.status=paid&order.date_created.from=${date2}T00:00:00.000-00:00&order.date_created.to=${date1}T00:00:00.000-00:00&sort=date_desc&search_type=scan`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  ).then(async (data2) => {
    ids2.push(data2.data.paging.scroll_id);
    const total = Math.ceil(data2.data.paging.total / 51);
    for (let index = 0; index < 2; index++) {
      const url = `https://api.mercadolibre.com/orders/search?seller=51940259&order.status=paid&order.date_created.from=${date2}T00:00:00.000-00:00&order.date_created.to=${date1}T00:00:00.000-00:00&sort=date_desc&search_type=scan&scroll_id=${ids2[index]}`;
      try {
        const response = await axios.get(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        ids2.push(response.data.paging.scroll_id);
        records.push(...response.data.results);
      } catch (error) {
        throw error;
      }
    }
  });

  return removeDuplicates(records);
}

// Function to fetch additional data for each item from the second API endpoint
async function fetchItemData(itemId, token) {
  const url = `https://api.mercadolibre.com/items/${itemId}`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data?.inventory_id ? response.data : null;
  } catch (error) {
    throw error;
  }
}

// Route to get and process items
router.post("/getitems", async (req, res) => {
  const { date1, date2 } = req.body;
  try {
    const tokenResponse = await axios.post("https://api.mercadolibre.com/oauth/token", {
      grant_type: "refresh_token",
      client_id: "4162556133958047",
      client_secret: "wt2Rtfe9pqKPMzsdW4cqgVwLj1d0gLFP",
      refresh_token: "TG-666b10ced60a090001ba6060-51940259",
    });

    const accessToken = tokenResponse.data.access_token;
    const orderData = await fetchOrderData(date1, date2, accessToken);

    const uniqueOrders = {};
    for (const order of orderData) {
      const sku = order.order_items[0].item.seller_sku;
      const itemName = skuToItemMap[sku] || order.order_items[0].item.title; // Use Excel data or fallback to original title
      const id = order.order_items[0].item.id;
      const quantity = order.order_items[0].quantity;

      const key = `${id}-${sku}`;
      if (uniqueOrders[key]) {
        uniqueOrders[key].quantity += quantity;
      } else {
        uniqueOrders[key] = { id, sku, title: itemName, quantity };
      }
    }


    const processedData = [];
    for (const order of Object.values(uniqueOrders)) {
      const { id, sku, quantity, title } = order;
      const itemData = await fetchItemData(id, accessToken);
      if (itemData?.inventory_id) {
        const stockData = await axios.get(
          `https://api.mercadolibre.com/inventories/${itemData.inventory_id}/stock/fulfillment`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        const processedItem = {
          id: itemData.inventory_id,
          title,
          seller_sku: sku,
          initial_quantity: itemData.initial_quantity,
          available_quantity: stockData.data.available_quantity,
          sold_quantity: quantity,
        };
        processedData.push(processedItem);
      }
    }

    const uniqueProcessedData = removeDuplicates(processedData);
    res.json({ processedData: uniqueProcessedData });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch and process items" });
  }
});


let maxTry = 0;
async function fetchOrders(
  accessToken,
  startDate,
  endDate,
  offset = 0,
  allOrders = []
) {
  try {
    maxTry = maxTry + 1;
    const response = await axios.get(
      `https://api.mercadolibre.com/orders/search/recent?seller=${"51940259"}&access_token=${accessToken}&date_created_from=${startDate.toISOString()}&date_created_to=${endDate.toISOString()}&offset=${offset}&sort=date_desc`
    );
    const orders = response.data.results;

    allOrders.push(...orders);

    if (orders.length === 51 && maxTry < 110) {
      return await fetchOrders(
        accessToken,
        startDate,
        endDate,
        offset + 50,
        allOrders
      );
    } else {
      // Remove duplicates based on unique identifier (e.g., order ID)
      const uniqueOrders = Array.from(new Set(allOrders.map(a => a.id)))
        .map(id => {
          return allOrders.find(a => a.id === id);
        });

      return uniqueOrders;
    }
  } catch (error) {
    throw new Error("Failed to fetch orders");
  }
}

// Route to fetch all orders within the last 7 days
router.post("/tryorders", async (req, res) => {
  try {
    await axios
      .post("https://api.mercadolibre.com/oauth/token", {
        grant_type: "refresh_token",
        client_id: "4162556133958047",
        client_secret: "wt2Rtfe9pqKPMzsdW4cqgVwLj1d0gLFP",
        refresh_token: "TG-666b10ced60a090001ba6060-51940259",
      })
      .then(async (data) => {
        maxTry = 0;
        try {
          const endDate = new Date(); // Today's date
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 7); // 7 days ago

          const accessToken = data.data.access_token; // Replace with your access token
          // console.log(accessToken);
          const orders = await fetchOrders(accessToken, startDate, endDate);

          // Send all fetched orders in the response
          res.json([...orders]);
        } catch (error) {
          res.status(500).json({ error: "Failed to fetch orders" });
        }
      });
  } catch (err) {
    res.json("Something went wrong!");
  }
});


// GET ONLY COMPLETED OR FILLED ORDERS
async function fetchFilledOrder(date1, date2, token) {
  let records = [];
  let ids2 = [];

  try {
    const initialResponse = await axios.get(
      `https://api.mercadolibre.com/orders/search?seller=51940259&order.status=paid&order.date_created.from=${date2}T00:00:00.000-00:00&order.date_created.to=${date1}T00:00:00.000-00:00&sort=date_desc&search_type=scan`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    ids2.push(initialResponse.data.paging.scroll_id);
    const total = Math.ceil(initialResponse.data.paging.total / 51);

    for (let index = 0; index < total; index++) {
      const url = `https://api.mercadolibre.com/orders/search?seller=51940259&order.status=paid&order.date_created.from=${date2}T00:00:00.000-00:00&order.date_created.to=${date1}T00:00:00.000-00:00&sort=date_desc&search_type=scan&scroll_id=${ids2[index]}`;

      try {
        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        ids2.push(response.data.paging.scroll_id);

        // Filter for fulfilled or full orders
        const fulfilledOrders = response.data.results.filter(order =>
          order.shipping.status === 'shipped' || order.shipping.status === 'delivered'
        );
        records.push(...fulfilledOrders);
      } catch (error) {
        console.error('Error fetching orders:', error);
        throw error;
      }
    }

    // Remove duplicates based on a unique identifier (e.g., order ID)
    const uniqueRecords = Array.from(new Set(records.map(a => a.id))).map(id => {
      return records.find(a => a.id === id);
    });

    return uniqueRecords;
  } catch (error) {
    console.error('Error fetching initial orders:', error);
    throw error;
  }
}

// Express route to get completed or filled orders
router.get('/getFilledOrder', async (req, res) => {
  const { date1, date2 } = req.query; // Assuming date1 and date2 are passed as query params
  const token = req.headers.authorization.split(' ')[1]; // Assuming the token is passed in the Authorization header

  try {
    const orders = await fetchFilledOrder(date1, date2, token);
    res.status(200).json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders', error: error.message });
  }
});

export default router;




