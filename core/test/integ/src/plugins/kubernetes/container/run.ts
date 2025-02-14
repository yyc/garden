/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { expect } from "chai"

import { expectError, TestGarden } from "../../../../../helpers"
import { ConfigGraph } from "../../../../../../src/graph/config-graph"
import { RunTask } from "../../../../../../src/tasks/run"
import { emptyDir, pathExists } from "fs-extra"
import { join } from "path"
import { getContainerTestGarden } from "./container"
import { clearRunResult } from "../../../../../../src/plugins/kubernetes/run-results"
import { KubernetesProvider } from "../../../../../../src/plugins/kubernetes/config"
import { ContainerRunAction } from "../../../../../../src/plugins/container/config"
import { createActionLog } from "../../../../../../src/logger/log-entry"
import { waitForOutputFlush } from "../../../../../../src/process"

describe("runContainerTask", () => {
  let garden: TestGarden
  let graph: ConfigGraph
  let provider: KubernetesProvider

  before(async () => {
    garden = await getContainerTestGarden()
    provider = <KubernetesProvider>await garden.resolveProvider(garden.log, "local-kubernetes")
  })

  beforeEach(async () => {
    graph = await garden.getConfigGraph({ log: garden.log, emit: false })
  })

  after(async () => {
    garden.close()
  })

  it("should run a basic Run and emit log events", async () => {
    const action = graph.getRun("echo-task-with-sleep")

    const testTask = new RunTask({
      garden,
      graph,
      action,
      log: garden.log,
      force: true,
      forceBuild: false,
    })

    garden.events.eventLog = []

    const ctx = await garden.getPluginContext({ provider, templateContext: undefined, events: undefined })
    await clearRunResult({ ctx, log: garden.log, action })

    const results = await garden.processTasks({ tasks: [testTask], throwOnError: true })
    const result = results.results.getResult(testTask)
    const logEvent = garden.events.eventLog.find((l) => l.name === "log")

    await waitForOutputFlush()

    expect(result).to.exist
    expect(result!.result).to.exist
    expect(result!.result!.detail?.log.trim()).to.equal("ok\nbear")
    expect(result!.result).to.have.property("outputs")
    expect(result!.result!.outputs.log.trim()).to.equal("ok\nbear")
    expect(result!.result!.detail?.namespaceStatus).to.exist
    expect(logEvent).to.exist

    // Verify that the result was saved
    const actions = await garden.getActionRouter()
    const resolvedAction = await garden.resolveAction<ContainerRunAction>({ action, log: garden.log, graph })
    const actionLog = createActionLog({
      log: garden.log,
      actionName: resolvedAction.name,
      actionKind: resolvedAction.kind,
    })

    const storedResult = await actions.run.getResult({
      log: actionLog,
      action: resolvedAction,
      graph,
    })

    expect(storedResult).to.exist
  })

  it("should not store Run results if cacheResult=false", async () => {
    const action = graph.getRun("echo-task")
    action["_config"].spec.cacheResult = false

    const testTask = new RunTask({
      garden,
      graph,
      action,
      log: garden.log,
      force: true,
      forceBuild: false,
    })

    const ctx = await garden.getPluginContext({ provider, templateContext: undefined, events: undefined })
    await clearRunResult({ ctx, log: garden.log, action })

    await garden.processTasks({ tasks: [testTask], throwOnError: true })

    // Verify that the result was not saved
    const router = await garden.getActionRouter()
    const resolvedAction = await garden.resolveAction<ContainerRunAction>({ action, log: garden.log, graph })
    const actionLog = createActionLog({
      log: garden.log,
      actionName: resolvedAction.name,
      actionKind: resolvedAction.kind,
    })

    const { result } = await router.run.getResult({
      log: actionLog,
      action: resolvedAction,
      graph,
    })

    expect(result.state).to.eql("not-ready")
  })

  it("should fail if an error occurs, but store the result", async () => {
    const action = graph.getRun("echo-task")
    action["_config"].spec.command = ["bork"] // this will fail

    const testTask = new RunTask({
      garden,
      graph,
      action,
      log: garden.log,
      force: true,
      forceBuild: false,
    })

    const ctx = await garden.getPluginContext({ provider, templateContext: undefined, events: undefined })
    await clearRunResult({ ctx, log: garden.log, action })

    await expectError(
      async () => await garden.processTasks({ tasks: [testTask], throwOnError: true }),
      (err) => expect(err.message).to.match(/bork/)
    )

    // We also verify that, despite the task failing, its result was still saved.
    const actions = await garden.getActionRouter()
    const resolvedAction = await garden.resolveAction<ContainerRunAction>({ action, log: garden.log, graph })
    const actionLog = createActionLog({
      log: garden.log,
      actionName: resolvedAction.name,
      actionKind: resolvedAction.kind,
    })

    const { result } = await actions.run.getResult({
      log: actionLog,
      action: resolvedAction,
      graph,
    })

    expect(result).to.exist
  })

  context("artifacts are specified", () => {
    it("should copy artifacts out of the container", async () => {
      const action = graph.getRun("artifacts-task")

      const testTask = new RunTask({
        garden,
        graph,
        action,
        log: garden.log,
        force: true,
        forceBuild: false,
      })

      await emptyDir(garden.artifactsPath)

      await garden.processTasks({ tasks: [testTask], throwOnError: true })

      expect(await pathExists(join(garden.artifactsPath, "task.txt"))).to.be.true
      expect(await pathExists(join(garden.artifactsPath, "subdir", "task.txt"))).to.be.true
    })

    it("should fail if an error occurs, but copy the artifacts out of the container", async () => {
      const action = graph.getRun("artifacts-task-fail")

      const testTask = new RunTask({
        garden,
        graph,
        action,
        log: garden.log,
        force: true,
        forceBuild: false,
      })
      await emptyDir(garden.artifactsPath)

      const results = await garden.processTasks({ tasks: [testTask], throwOnError: false })

      expect(results.error).to.exist

      expect(await pathExists(join(garden.artifactsPath, "test.txt"))).to.be.true
      expect(await pathExists(join(garden.artifactsPath, "subdir", "test.txt"))).to.be.true
    })

    it("should handle globs when copying artifacts out of the container", async () => {
      const action = graph.getRun("globs-task")

      const testTask = new RunTask({
        garden,
        graph,
        action,
        log: garden.log,
        force: true,
        forceBuild: false,
      })

      await emptyDir(garden.artifactsPath)

      await garden.processTasks({ tasks: [testTask], throwOnError: true })

      expect(await pathExists(join(garden.artifactsPath, "subdir", "task.txt"))).to.be.true
      expect(await pathExists(join(garden.artifactsPath, "output.txt"))).to.be.true
    })

    it("should throw when container doesn't contain sh", async () => {
      const action = graph.getRun("missing-sh-task")

      const testTask = new RunTask({
        garden,
        graph,
        action,
        log: garden.log,
        force: true,
        forceBuild: false,
      })

      const result = await garden.processTasks({ tasks: [testTask], throwOnError: false })

      expect(result.results.getAll()[0]?.name).to.eql("missing-sh-task")
      expect(result.error).to.exist
      expect(result.error?.message).to.include("both sh and tar need to be installed in the image")
    })

    it("should throw when container doesn't contain tar", async () => {
      const action = graph.getRun("missing-tar-task")

      const testTask = new RunTask({
        garden,
        graph,
        action,
        log: garden.log,
        force: true,
        forceBuild: false,
      })

      const result = await garden.processTasks({ tasks: [testTask], throwOnError: false })

      expect(result.results.getAll()[0]?.name).to.eql("missing-tar-task")
      expect(result.error).to.exist
      expect(result.error?.message).to.include("both sh and tar need to be installed in the image")
    })
  })
})
