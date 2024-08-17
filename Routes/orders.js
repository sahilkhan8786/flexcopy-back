import express from "express";
import axios from "axios";

const router = express.Router();
let ids2 = [];

router.post("/getorders", async (req, res) => {
  await axios
    .post("https://api.mercadolibre.com/oauth/token", {
      grant_type: "refresh_token",
      client_id: "4162556133958047",
      client_secret: "wt2Rtfe9pqKPMzsdW4cqgVwLj1d0gLFP",
      refresh_token: "TG-666b10ced60a090001ba6060-51940259",
    })
    .then(async (data) => {
      let records = [];
      let ids = [];
      for (let index = 0; index < 2; index++) {
        await axios
          .get(
            index !== 0
              ? `https://api.mercadolibre.com/orders/search/recent?seller=51940259&sort=date_desc&search_type=scan&scroll_id=${ids[index - 1]}`
              : `https://api.mercadolibre.com/orders/search?seller=51940259&sort=date_desc&search_type=scan`,
            {
              headers: {
                Authorization: `Bearer ${data.data?.access_token}`,
              },
            }
          )
          .then((response) => {
            ids.push(response.data.paging.scroll_id);
            records.push(...response.data.results);
          })
          .catch((error) => {
            // handle error
          });
      }

      // Remove duplicates based on a unique identifier (e.g., order ID)
      const uniqueRecords = Array.from(new Set(records.map(a => a.id)))
        .map(id => {
          return records.find(a => a.id === id);
        });

      res.json(uniqueRecords);
    });
});
async function fetchOrderData(date1, date2, token) {
  let records = [];
  await axios
    .get(
      `https://api.mercadolibre.com/orders/search?seller=51940259&order.status=paid&order.date_created.from=${date2}T00:00:00.000-00:00&order.date_created.to=${date1}T00:00:00.000-00:00&sort=date_desc&search_type=scan`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    )
    .then(async (data2) => {
      ids2.push(data2.data.paging.scroll_id);
      const total = Math.ceil(data2.data.paging.total / 51);
      for (let index = 0; index < 2; index++) {
        const url = `https://api.mercadolibre.com/orders/search?seller=51940259&order.status=paid&order.date_created.from=${date2}T00:00:00.000-00:00&order.date_created.to=${date1}T00:00:00.000-00:00&sort=date_desc&search_type=scan&scroll_id=${ids2[index]}`;

        try {
          const response = await axios.get(url, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          ids2.push(response.data.paging.scroll_id);
          records.push(...response.data.results);
        } catch (error) {
          throw error;
        }
      }
    });

  // Remove duplicates based on a unique identifier (e.g., order ID)
  const uniqueRecords = Array.from(new Set(records.map(a => a.id)))
    .map(id => {
      return records.find(a => a.id === id);
    });

  return uniqueRecords;
}


// Function to fetch additional data for each item from the second API endpoint
async function fetchItemData(itemId, token, date1, date2) {
  const url = `https://api.mercadolibre.com/items/${itemId}`;
  // let record = {};

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.data?.inventory_id) {
      return response.data;
    }
  } catch (error) {
    // console.error("Error fetching item data:", error);
    throw error;
  }
}

router.post("/getitems", async (req, res) => {
  const { date1, date2 } = req.body;

  await axios
    .post("https://api.mercadolibre.com/oauth/token", {
      grant_type: "refresh_token",
      client_id: "4162556133958047",
      client_secret: "wt2Rtfe9pqKPMzsdW4cqgVwLj1d0gLFP",
      refresh_token: "TG-666b10ced60a090001ba6060-51940259",
    })
    .then(async (data) => {
      const orderData = await fetchOrderData(
        date1,
        date2,
        data.data.access_token
      );

      const uniqueOrders = {};
      for (const order of orderData) {
        const title = order.order_items[0].item.title;
        const quantity = order.order_items[0].quantity;
        const id = order.order_items[0].item.id;
        const sku = order.order_items[0].item.seller_sku;

        const key = id + "-" + sku;

        if (uniqueOrders[key]) {
          uniqueOrders[key].quantity += quantity;
        } else {
          uniqueOrders[key] = { id, sku, title, quantity };
        }
      }

      const uniqueOrdersArray = Object.values(uniqueOrders);

      const processedData = [];

      for (const order of uniqueOrdersArray) {
        const { id, sku } = order;
        const { quantity } = order;

        const itemData = await fetchItemData(
          id,
          data.data.access_token,
          date1,
          date2
        );

        if (itemData?.inventory_id) {
          await axios
            .get(
              `https://api.mercadolibre.com/inventories/${itemData.inventory_id}/stock/fulfillment`,
              {
                headers: {
                  Authorization: `Bearer ${data.data.access_token}`,
                },
              }
            )
            .then((res) => {
              const processedItem = {
                id: itemData.inventory_id,
                title: itemData.title,
                seller_sku: sku,
                initial_quantity: itemData.initial_quantity,
                available_quantity: res.data.available_quantity,
                sold_quantity: quantity,
              };
              processedData.push(processedItem);
            });
        }
      }

      // Remove duplicates from processedData based on unique identifier
      const uniqueProcessedData = Array.from(new Set(processedData.map(a => a.id)))
        .map(id => {
          return processedData.find(a => a.id === id);
        });

      res.json({ processedData: uniqueProcessedData });
    });
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
          console.log(accessToken);
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

export default router;
