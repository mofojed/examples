import React, { useCallback, useEffect, useState } from "react";
import { LoadingOverlay } from "@deephaven/components"; // Use the loading spinner from the Deephaven components package
import {
  IrisGrid,
  IrisGridModel,
  IrisGridModelFactory,
} from "@deephaven/iris-grid"; // iris-grid is used to display Deephaven tables
import dh from "@deephaven/jsapi-shim"; // Import the shim to use the JS API
import "./App.scss"; // Styles for in this app

const API_URL = process.env.REACT_APP_DEEPHAVEN_API_URL ?? "";

const USER = process.env.REACT_APP_DEEPHAVEN_USER ?? "";

const PASSWORD = process.env.REACT_APP_DEEPHAVEN_PASSWORD ?? "";

/**
 * Load an existing Deephaven table with the client and query name provided
 * Needs to listen for when queries are added to the list as they are not known immediately after connecting.
 * @param client The Deephaven client object
 * @param queryName Name of the query to load
 * @param tableName Name of the table to load
 * @returns Deephaven table
 */
function loadTable(client: any, queryName: string, tableName: string) {
  console.log(`Fetching query ${queryName}, table ${tableName}...`);

  return new Promise((resolve, reject) => {
    let removeListener: () => void;

    const timeout = setTimeout(() => {
      reject(new Error(`Query not found, ${queryName}`));
      removeListener();
    }, 10000);

    function resolveIfQueryFound(queries: any[]) {
      const matchingQuery = queries.find((query) => query.name === queryName);

      if (matchingQuery) {
        resolve(matchingQuery.getTable(tableName));
        clearTimeout(timeout);
        removeListener();
      }
    }

    function listener(event: any) {
      const addedQueries = [event.detail];
      resolveIfQueryFound(addedQueries);
    }

    removeListener = client.addEventListener(
      dh.Client.EVENT_CONFIG_ADDED,
      listener
    );
    const initialQueries = client.getKnownConfigs();
    resolveIfQueryFound(initialQueries);
  });
}

/**
 * Create a new Deephaven table with the session provided.
 * Creates a table that will tick once every second, with two columns:
 * - Timestamp: The timestamp of the tick
 * - A: The row number
 * @param client The Deephaven client object
 * @param name Name of the table to load
 * @returns Deephaven table
 */
async function createTable(client: any) {
  throw new Error(
    "Creating table not yet implemented in example, please provide queryName/tableName in the URL params"
  );
}

/**
 * A functional React component that displays a Deephaven table in an IrisGrid using the @deephaven/iris-grid package.
 * If the query param `tableName` is provided, it will attempt to open and display that table, expecting it to be present on the server.
 * E.g. http://localhost:3000/?tableName=myTable will attempt to open a table `myTable`
 * If no query param is provided, it will attempt to open a new session and create a basic time table and display that.
 * By default, tries to connect to the server defined in the REACT_APP_CORE_API_URL variable, which is set to http://localhost:1000/jsapi
 * See create-react-app docs for how to update these env vars: https://create-react-app.dev/docs/adding-custom-environment-variables/
 */
function App() {
  const [model, setModel] = useState<IrisGridModel>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);

  const initApp = useCallback(async () => {
    try {
      // Connect to the Web API server
      const baseUrl = new URL(API_URL ?? "", `${window.location}`);

      const websocketUrl = new URL("/socket", baseUrl);
      if (websocketUrl.protocol === "http:") {
        websocketUrl.protocol = "ws:";
      } else {
        websocketUrl.protocol = "wss:";
      }

      console.log(`Creating client ${websocketUrl}...`);

      const client = new dh.Client(websocketUrl.href);

      await client.login({ username: USER, token: PASSWORD, type: "password" });

      // Get the table name from the search params `queryName` and `tableName`.
      const searchParams = new URLSearchParams(window.location.search);
      const queryName = searchParams.get("queryName");
      const tableName = searchParams.get("tableName");

      // If a table name was specified, load that table. Otherwise, create a new table.
      const table = await (queryName && tableName
        ? loadTable(client, queryName, tableName)
        : createTable(client));

      // Create the `IrisGridModel` for use with the `IrisGrid` component
      console.log(`Creating model...`);

      const newModel = await IrisGridModelFactory.makeModel(table);

      setModel(newModel);

      console.log("Table successfully loaded!");
    } catch (e) {
      console.error("Unable to load table", e);
      setError(`${e}`);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    initApp();
  }, [initApp]);

  const isLoaded = model != null;

  return (
    <div className="App">
      {isLoaded && <IrisGrid model={model} />}
      {!isLoaded && (
        <LoadingOverlay
          isLoaded={isLoaded}
          isLoading={isLoading}
          errorMessage={error ? error : null}
        />
      )}
    </div>
  );
}

export default App;
