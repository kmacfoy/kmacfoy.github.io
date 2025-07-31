param location string = resourceGroup().location
param storageAccountName string
param functionAppName string
param cosmosDbAccountName string
param databaseName string
param containerName string
param cdnProfileName string
param cdnEndpointName string
param hostingPlanName string

// Storage Account with Static Website enabled
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: true
  }
}
// Static Website Configuration
resource staticWebsite 'Microsoft.Storage/storageAccounts/staticWebsite@2023-01-01' = {
  name: 'default'
  parent: storageAccount
  properties: {
    indexDocument: 'index.html'
    error404Document: '404.html'
  }
}
// Cosmos DB Account
resource cosmosDbAccount 'Microsoft.DocumentDB/databaseAccounts@2023-03-15' = {
  name: cosmosDbAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
  }
}

// Cosmos DB SQL Database
resource cosmosDbDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-03-15' = {
  name: '${cosmosDbAccount.name}/${databaseName}'
  properties: {
    resource: {
      id: databaseName
    }
  }
}

// Cosmos DB SQL Container
resource cosmosDbContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-03-15' = {
  name: '${cosmosDbDatabase.name}/${containerName}'
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
    }
  }
}

// Hosting Plan for Function App
resource hostingPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: hostingPlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
}

// Function App with App Settings
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: hostingPlan.id
    reserved: true //required for Linux
    siteConfig: {
      linuxFxVersion: 'Node|18'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: listKeys(storageAccount.id, '2023-01-01').keys[0].value
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmosDbAccount.properties.documentEndpoint
        }
        {
          name: 'COSMOS_KEY'
          value: listKeys(cosmosDbAccount.id, '2023-03-15').primaryMasterKey
        }
        {name: 'FUNCTIONS_WORKER_RUNTIME'
         value: 'node'
        }
        {name: 'WEBSITE_RUN_FROM_PACKAGE'
         value: '1'
        }
      ]
    }
    httpsOnly: true
  }
}

// CDN Profile
resource cdnProfile 'Microsoft.Cdn/profiles@2021-06-01' = {
  name: cdnProfileName
  location: 'global'
  sku: {
    name: 'Standard_Microsoft'
  }
}

// CDN Endpoint
resource cdnEndpoint 'Microsoft.Cdn/profiles/endpoints@2021-06-01' = {
  name: cdnEndpointName
  parent: cdnProfile
  location: 'global'
  properties: {
    origins: [
      {
        name: 'origin1'
        properties: {
          hostName: '${storageAccount.name}.blob.core.windows.net'
        }
      }
    ]
    isHttpAllowed: false
    isHttpsAllowed: true
  }
}
