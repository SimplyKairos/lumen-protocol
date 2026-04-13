import 'dotenv/config'
import { db } from './db'
import { buildServer } from './server'
import type { BundleLookupResult } from './bam-service'
import type {
  AnchorReceiptHashResult,
  MemoTransactionLookupResult,
} from './memo-service'
import type { WebhookSendRequest } from './webhook-service'

const receiptFieldKeys = [
  'receiptId',
  'txSignature',
  'bundleId',
  'slot',
  'confirmationStatus',
  'receiptHash',
  'onChainMemo',
  'attestationLevel',
  'walletAddress',
  'verified',
  'createdAt',
] as const

const launchActivateRouteTemplate = '/api/v1/launches/:launchId/activate'
const launchTradeRouteTemplate = '/api/v1/launches/:launchId/trades'

async function testFullFlow() {
  console.log('🔵 Starting Lumen Protocol test flow...\n')
  const testRunId = Date.now()
  const txSignature = `test-sig-${testRunId}`
  const bundleId = `test-bundle-${testRunId}`
  const mismatchTxSignature = `test-sig-mismatch-${testRunId}`
  const mismatchBundleId = `test-bundle-mismatch-${testRunId}`
  const launchTradeTxSignature = `launch-trade-sig-${testRunId}`
  const secondLaunchTradeTxSignature = `launch-trade-sig-second-${testRunId}`
  const launchTradeBundleId = `launch-trade-bundle-${testRunId}`
  const creatorWallet = `CreatorWallet-${testRunId}`
  const liveLaunchActivatedAt = Date.now()
  const launchTradeExecutionTimes = new Map<string, number>([
    [launchTradeTxSignature, liveLaunchActivatedAt + 500],
    [secondLaunchTradeTxSignature, liveLaunchActivatedAt + 1_500],
  ])
  const memoTransactions = new Map<string, MemoTransactionLookupResult>()
  const sentWebhookRequests: WebhookSendRequest[] = []
  const bundleFixtures = new Map<string, { slot: number; transactions: string[] }>([
    [bundleId, { slot: 324901882, transactions: [txSignature] }],
    [mismatchBundleId, { slot: 324901883, transactions: [mismatchTxSignature] }],
    [launchTradeBundleId, { slot: 324901990, transactions: [launchTradeTxSignature, secondLaunchTradeTxSignature] }],
  ])
  let anchorCallCount = 0

  db.prepare('DELETE FROM webhook_deliveries').run()
  db.prepare('DELETE FROM webhook_subscriptions').run()

  const app = buildServer({
    getBundleData: async (requestedBundleId): Promise<BundleLookupResult> => ({
      status: 'ok',
      data: {
        bundleId: requestedBundleId,
        slot: bundleFixtures.get(requestedBundleId)?.slot ?? 324901882,
        confirmationStatus: 'confirmed',
        transactions: bundleFixtures.get(requestedBundleId)?.transactions ?? [txSignature],
      },
    }),
    anchorReceiptHash: async (receiptHash): Promise<AnchorReceiptHashResult> => {
      anchorCallCount += 1
      const memoSignature = `memo-sig-${anchorCallCount}`
      const memoText = anchorCallCount === 2 ? `mismatch-${receiptHash}` : receiptHash

      memoTransactions.set(memoSignature, {
        status: 'ok',
        data: {
          signature: memoSignature,
          memoText,
          slot: 324901882,
        },
      })

      return {
        ok: true,
        memoSignature,
      }
    },
    getMemoTransactionData: async (signature): Promise<MemoTransactionLookupResult> => {
      return memoTransactions.get(signature) ?? { status: 'not_found' }
    },
    sendWebhookRequest: async (request) => {
      sentWebhookRequests.push(request)

      if (request.url.includes('/failure')) {
        return {
          ok: false,
          responseStatus: 500,
          errorMessage: 'receiver_status_500',
        }
      }

      return {
        ok: true,
        responseStatus: 202,
      }
    },
    activateLaunchOnDbc: async (input) => ({
      dbcConfigAddress: `dbc-config-${input.launchId.slice(0, 8)}`,
      dbcPoolAddress: `dbc-pool-${input.launchId.slice(0, 8)}`,
      activatedAt: liveLaunchActivatedAt,
    }),
    executeLaunchTrade: async (input) => ({
      side: input.side,
      amountIn: input.amountIn,
      minAmountOut: input.minAmountOut,
      walletAddress: input.walletAddress ?? null,
      executedAt: launchTradeExecutionTimes.get(input.txSignature) ?? liveLaunchActivatedAt + 2_500,
    }),
  })

  try {
    console.log('1. Creating webhook subscriptions...')
    const successSubscriptionRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      payload: {
        targetUrl: 'https://integrator.test/success',
      },
    })
    const successSubscriptionPayload = successSubscriptionRes.json() as any

    if (
      successSubscriptionRes.statusCode !== 201 ||
      !successSubscriptionPayload.signingSecret ||
      successSubscriptionPayload.subscription?.signingSecretMasked == null ||
      successSubscriptionPayload.subscription.signingSecretMasked === successSubscriptionPayload.signingSecret
    ) {
      console.error('❌ Success subscription failed:', successSubscriptionPayload)
      process.exit(1)
    }

    const successSubscriptionId = successSubscriptionPayload.subscription.subscriptionId
    const successSigningSecret = successSubscriptionPayload.signingSecret

    const failureSubscriptionRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      payload: {
        targetUrl: 'https://integrator.test/failure',
      },
    })
    const failureSubscriptionPayload = failureSubscriptionRes.json() as any

    if (
      failureSubscriptionRes.statusCode !== 201 ||
      !failureSubscriptionPayload.signingSecret ||
      failureSubscriptionPayload.subscription?.signingSecretMasked == null ||
      failureSubscriptionPayload.subscription.signingSecretMasked === failureSubscriptionPayload.signingSecret
    ) {
      console.error('❌ Failure subscription failed:', failureSubscriptionPayload)
      process.exit(1)
    }

    const failureSubscriptionId = failureSubscriptionPayload.subscription.subscriptionId

    console.log('✅ Webhook subscriptions created')
    console.log()

    console.log('2. Stamping a transaction...')
    const deliveryOffset = sentWebhookRequests.length
    const stampRes = await app.inject({
      method: 'POST',
      url: '/api/v1/stamp',
      payload: {
        txSignature,
        bundleId,
        walletAddress: 'TestWallet123',
      },
    })

    const receipt = stampRes.json() as any

    if (stampRes.statusCode !== 201 || !receipt.receiptId || !receipt.onChainMemo) {
      console.error('❌ Stamp failed:', receipt)
      process.exit(1)
    }

    const primaryDeliveries = sentWebhookRequests.slice(deliveryOffset)
    const successDelivery = primaryDeliveries.find(request => request.url.includes('/success'))
    const failureDelivery = primaryDeliveries.find(request => request.url.includes('/failure'))

    console.log('✅ Receipt issued:', receipt.receiptId)
    console.log('   Hash:', receipt.receiptHash)
    console.log('   Level:', receipt.attestationLevel)
    console.log()

    if (
      primaryDeliveries.length !== 2 ||
      !successDelivery ||
      !failureDelivery ||
      successDelivery.headers['x-lumen-event-type'] !== 'receipt.issued' ||
      !successDelivery.headers['x-lumen-signature'] ||
      !successDelivery.headers['x-lumen-signature'].startsWith('sha256=') ||
      !successDelivery.headers['x-lumen-timestamp']
    ) {
      console.error('❌ Webhook delivery contract failed:', primaryDeliveries)
      process.exit(1)
    }

    const successEvent = JSON.parse(successDelivery.body) as any

    if (successEvent.eventType !== 'receipt.issued' || !successEvent.eventId || !successEvent.receipt) {
      console.error('❌ Webhook event envelope failed:', successEvent)
      process.exit(1)
    }

    const receiptMatches = receiptFieldKeys.every(
      key => successEvent.receipt[key] === receipt[key]
    )

    if (!receiptMatches) {
      console.error('❌ Nested webhook receipt drift detected:', successEvent.receipt, receipt)
      process.exit(1)
    }

    console.log('✅ receipt.issued delivery captured with canonical nested receipt')
    console.log()

    console.log('3. Re-stamping to confirm idempotency...')
    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/stamp',
      payload: {
        txSignature,
        bundleId,
        walletAddress: 'TestWallet123',
      },
    })
    const duplicateReceipt = duplicateRes.json() as any

    if (duplicateRes.statusCode !== 200 || duplicateReceipt.receiptId !== receipt.receiptId) {
      console.error('❌ Duplicate stamp failed:', duplicateReceipt)
      process.exit(1)
    }

    if (sentWebhookRequests.length !== deliveryOffset + 2) {
      console.error('❌ Duplicate stamp unexpectedly triggered new webhooks')
      process.exit(1)
    }

    console.log('✅ Duplicate stamp returned existing receipt')
    console.log()

    console.log('4. Verifying anchored receipt...')
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/verify/${receipt.receiptId}`,
    })
    const verification = verifyRes.json() as any

    if (
      verifyRes.statusCode !== 200 ||
      verification.hashMatches !== true ||
      verification.memoMatches !== true ||
      verification.verificationStatus !== 'VERIFIED' ||
      verification.verified !== true
    ) {
      console.error('❌ Verification failed:', verification)
      process.exit(1)
    }

    console.log('✅ Verification status:', verification.verificationStatus)
    console.log('✅ Hash matches:', verification.hashMatches)
    console.log('✅ Verified flag:', verification.verified)
    console.log()

    console.log('5. Inspecting webhook delivery history...')
    const successHistoryRes = await app.inject({
      method: 'GET',
      url: `/api/v1/webhooks/${successSubscriptionId}/deliveries`,
    })
    const successHistory = successHistoryRes.json() as any

    if (
      successHistoryRes.statusCode !== 200 ||
      successHistory.subscription.subscriptionId !== successSubscriptionId ||
      successHistory.subscription.signingSecretMasked !== successSubscriptionPayload.subscription.signingSecretMasked ||
      successHistory.subscription.signingSecretMasked === successSigningSecret ||
      !successHistory.deliveries.some((delivery: any) => delivery.status === 'delivered')
    ) {
      console.error('❌ Success delivery history failed:', successHistory)
      process.exit(1)
    }

    const failureHistoryRes = await app.inject({
      method: 'GET',
      url: `/api/v1/webhooks/${failureSubscriptionId}/deliveries`,
    })
    const failureHistory = failureHistoryRes.json() as any

    if (
      failureHistoryRes.statusCode !== 200 ||
      failureHistory.subscription.subscriptionId !== failureSubscriptionId ||
      !failureHistory.deliveries.some((delivery: any) => delivery.status === 'failed')
    ) {
      console.error('❌ Failure delivery history failed:', failureHistory)
      process.exit(1)
    }

    console.log('✅ Delivery history shows delivered and failed webhook states')
    console.log()

    console.log('6. Stamping mismatch fixture...')
    const mismatchStampRes = await app.inject({
      method: 'POST',
      url: '/api/v1/stamp',
      payload: {
        txSignature: mismatchTxSignature,
        bundleId: mismatchBundleId,
        walletAddress: 'TestWallet456',
      },
    })
    const mismatchReceipt = mismatchStampRes.json() as any

    if (mismatchStampRes.statusCode !== 201 || !mismatchReceipt.receiptId || !mismatchReceipt.onChainMemo) {
      console.error('❌ Mismatch stamp failed:', mismatchReceipt)
      process.exit(1)
    }

    console.log('✅ Mismatch receipt issued:', mismatchReceipt.receiptId)
    console.log()

    console.log('7. Verifying mismatch status...')
    const mismatchVerifyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/verify/${mismatchReceipt.receiptId}`,
    })
    const mismatchVerification = mismatchVerifyRes.json() as any

    if (
      mismatchVerifyRes.statusCode !== 200 ||
      mismatchVerification.hashMatches !== true ||
      mismatchVerification.memoMatches !== false ||
      mismatchVerification.verificationStatus !== 'MEMO_MISMATCH' ||
      mismatchVerification.verified !== false
    ) {
      console.error('❌ Mismatch verification failed:', mismatchVerification)
      process.exit(1)
    }

    console.log('✅ Mismatch status:', mismatchVerification.verificationStatus)
    console.log()

    console.log('8. Fetching receipts list...')
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/receipts',
    })
    const list = listRes.json() as any
    const listedReceipt = list.receipts.find((item: any) => item.receiptId === receipt.receiptId)

    if (
      listRes.statusCode !== 200 ||
      !listedReceipt ||
      listedReceipt.createdAt == null ||
      listedReceipt.walletAddress !== 'TestWallet123' ||
      listedReceipt.onChainMemo == null ||
      'tx_signature' in listedReceipt ||
      'created_at' in listedReceipt
    ) {
      console.error('❌ Receipts list failed:', list)
      process.exit(1)
    }

    console.log(`✅ Found ${list.count} receipts in DB`)
    console.log()

    console.log('9. Creating a launch...')
    const launchRes = await app.inject({
      method: 'POST',
      url: '/api/v1/launch',
      payload: {
        tokenName: 'Launch Flow Token',
        tokenSymbol: 'LFT',
        creatorWallet,
        launchWindowSeconds: 120,
        alphaVaultMode: 'FCFS',
        description: 'Launch flow verification',
      },
    })
    const launch = launchRes.json() as any

    if (
      launchRes.statusCode !== 201 ||
      !launch.launchId ||
      launch.status !== 'configured' ||
      !launch.alphaVaultAddress
    ) {
      console.error('❌ Launch creation failed:', launch)
      process.exit(1)
    }

    console.log('✅ Launch created:', launch.launchId)
    console.log()

    console.log('10. Activating the launch...')
    const activateRes = await app.inject({
      method: 'POST',
      url: launchActivateRouteTemplate.replace(':launchId', launch.launchId),
    })
    const activatedLaunch = activateRes.json() as any

    if (
      activateRes.statusCode !== 200 ||
      activatedLaunch.status !== 'live' ||
      !activatedLaunch.dbcConfigAddress ||
      !activatedLaunch.dbcPoolAddress
    ) {
      console.error('❌ Launch activation failed:', activatedLaunch)
      process.exit(1)
    }

    console.log('✅ Launch activated on DBC seam')
    console.log()

    console.log('11. Trading the live launch and stamping a linked receipt...')
    const launchTradeOffset = sentWebhookRequests.length
    const launchTradeRes = await app.inject({
      method: 'POST',
      url: launchTradeRouteTemplate.replace(':launchId', launch.launchId),
      payload: {
        txSignature: launchTradeTxSignature,
        bundleId: launchTradeBundleId,
        walletAddress: 'LaunchTraderWallet123',
        side: 'buy',
        amountIn: 25,
        minAmountOut: 20,
      },
    })
    const launchTrade = launchTradeRes.json() as any

    if (
      launchTradeRes.statusCode !== 201 ||
      launchTrade.launch.launchId !== launch.launchId ||
      launchTrade.launch.status !== 'live' ||
      !launchTrade.receipt.receiptId ||
      launchTrade.trade.side !== 'buy'
    ) {
      console.error('❌ Launch trade failed:', launchTrade)
      process.exit(1)
    }

    const linkedReceiptRow = db.prepare(`
      SELECT launch_id
      FROM receipts
      WHERE id = ?
    `).get(launchTrade.receipt.receiptId) as { launch_id: string | null } | undefined

    if (!linkedReceiptRow || linkedReceiptRow.launch_id !== launch.launchId) {
      console.error('❌ Launch receipt linkage failed:', linkedReceiptRow)
      process.exit(1)
    }

    const launchTradeDeliveries = sentWebhookRequests.slice(launchTradeOffset)

    if (launchTradeDeliveries.length !== 2) {
      console.error('❌ Launch trade webhook fanout failed:', launchTradeDeliveries)
      process.exit(1)
    }

    console.log('✅ Live launch trade issued a linked canonical receipt')
    console.log()

    console.log('12. Executing a second protected-window trade in the same bundle...')
    const secondLaunchTradeRes = await app.inject({
      method: 'POST',
      url: launchTradeRouteTemplate.replace(':launchId', launch.launchId),
      payload: {
        txSignature: secondLaunchTradeTxSignature,
        bundleId: launchTradeBundleId,
        walletAddress: 'LaunchTraderWallet456',
        side: 'buy',
        amountIn: 35,
        minAmountOut: 28,
      },
    })
    const secondLaunchTrade = secondLaunchTradeRes.json() as any

    if (
      secondLaunchTradeRes.statusCode !== 201 ||
      secondLaunchTrade.launch.launchId !== launch.launchId ||
      secondLaunchTrade.launch.bundlerAlertCount < 1
    ) {
      console.error('❌ Second protected-window trade failed:', secondLaunchTrade)
      process.exit(1)
    }

    console.log('✅ Same-bundle protected-window activity recorded')
    console.log()

    console.log('13. Fetching launch detail for protected-window trust context...')
    const launchDetailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/launches/${launch.launchId}`,
    })
    const launchDetail = launchDetailRes.json() as any

    if (
      launchDetailRes.statusCode !== 200 ||
      launchDetail.bundlerAlertCount < 1 ||
      launchDetail.protectedWindowActive !== true ||
      !Array.isArray(launchDetail.recentBundlerAlerts) ||
      launchDetail.recentBundlerAlerts.length === 0 ||
      launchDetail.recentBundlerAlerts[0]?.alertType !== 'same_bundle_cluster'
    ) {
      console.error('❌ Launch detail protected-window context failed:', launchDetail)
      process.exit(1)
    }

    console.log('✅ Launch detail exposes active protected-window alert history')
    console.log()

    console.log('14. Fetching creator trust profile...')
    const creatorProfileRes = await app.inject({
      method: 'GET',
      url: `/api/v1/creators/${creatorWallet}`,
    })
    const creatorProfile = creatorProfileRes.json() as any

    if (
      creatorProfileRes.statusCode !== 200 ||
      creatorProfile.walletAddress !== creatorWallet ||
      creatorProfile.launchCount !== 1 ||
      creatorProfile.receiptCount !== 2 ||
      creatorProfile.successfulLaunches !== 1 ||
      creatorProfile.bundlerAlertCount < 1 ||
      !Array.isArray(creatorProfile.recentLaunches) ||
      creatorProfile.recentLaunches[0]?.launchId !== launch.launchId ||
      creatorProfile.recentLaunches[0]?.launchWindowSeconds !== 120 ||
      !Array.isArray(creatorProfile.recentBundlerAlerts) ||
      creatorProfile.recentBundlerAlerts.length === 0 ||
      creatorProfile.recentBundlerAlerts[0]?.launchId !== launch.launchId ||
      creatorProfile.recentBundlerAlerts[0]?.alertType !== 'same_bundle_cluster'
    ) {
      console.error('❌ Creator profile failed:', creatorProfile)
      process.exit(1)
    }

    console.log('✅ Creator profile shows launch history and protected-window alert rollups')
    console.log()

    console.log('15. Re-submitting the same launch trade to confirm alert idempotency...')
    const duplicateLaunchTradeRes = await app.inject({
      method: 'POST',
      url: launchTradeRouteTemplate.replace(':launchId', launch.launchId),
      payload: {
        txSignature: launchTradeTxSignature,
        bundleId: launchTradeBundleId,
        walletAddress: 'LaunchTraderWallet123',
        side: 'buy',
        amountIn: 25,
        minAmountOut: 20,
      },
    })
    const duplicateLaunchTrade = duplicateLaunchTradeRes.json() as any
    const alertCountRow = db.prepare(`
      SELECT COUNT(*) AS alert_count
      FROM bundler_alerts
      WHERE launch_id = ?
    `).get(launch.launchId) as { alert_count: number }

    if (
      duplicateLaunchTradeRes.statusCode !== 200 ||
      duplicateLaunchTrade.receipt.receiptId !== launchTrade.receipt.receiptId ||
      alertCountRow.alert_count !== 1
    ) {
      console.error('❌ Duplicate launch trade idempotency failed:', duplicateLaunchTrade, alertCountRow)
      process.exit(1)
    }

    console.log('✅ Duplicate launch trade did not create a second alert')
    console.log()

    console.log('16. Simulating post-window historical reads...')
    db.prepare(`
      UPDATE launches
      SET activated_at = ?
      WHERE id = ?
    `).run(
      liveLaunchActivatedAt - 600_000,
      launch.launchId
    )

    const historicalLaunchRes = await app.inject({
      method: 'GET',
      url: `/api/v1/launches/${launch.launchId}`,
    })
    const historicalLaunch = historicalLaunchRes.json() as any

    if (
      historicalLaunchRes.statusCode !== 200 ||
      historicalLaunch.protectedWindowActive !== false ||
      historicalLaunch.bundlerAlertCount < 1 ||
      !Array.isArray(historicalLaunch.recentBundlerAlerts) ||
      historicalLaunch.recentBundlerAlerts.length === 0
    ) {
      console.error('❌ Historical protected-window visibility failed:', historicalLaunch)
      process.exit(1)
    }

    console.log('✅ Historical alert rows remain visible after the protection window closes')
    console.log()

    console.log('🟢 All tests passed. Lumen Protocol is working.\n')
  } finally {
    await app.close()
  }
}

testFullFlow().catch(err => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
