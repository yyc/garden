/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { runBaseParams, PluginRunActionParamsBase, actionParamsSchema } from "../../../plugin/base"
import { dedent } from "../../../util/string"
import { RunAction } from "../../../actions/run"
import { ActionTypeHandlerSpec } from "../base/base"
import { GetRunResult, getRunResultSchema } from "./get-result"
import { Resolved } from "../../../actions/types"

export interface CommonRunParams {
  artifactsPath: string
  interactive: boolean
}

type RunActionParams<T extends RunAction> = PluginRunActionParamsBase<T> & CommonRunParams

export class RunRunAction<T extends RunAction = RunAction> extends ActionTypeHandlerSpec<
  "Run",
  RunActionParams<Resolved<T>>,
  GetRunResult<T>
> {
  description = dedent`
    Performs a Run. This should wait until execution completes, and return its output.
  `

  paramsSchema = () => actionParamsSchema().keys(runBaseParams())
  resultSchema = () => getRunResultSchema()
}
