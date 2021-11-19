const backtest = {
  DEF_MAX_PARAM_NAME: 'Net Profit All'
}

backtest.testStrategy = async (testResults, strategyData, allRangeParams) => {
  testResults.perfomanceSummary = []
  testResults.filteredSummary = []
  testResults.shortName = strategyData.name
  console.log('testStrategy', testResults.shortName, testResults.isMaximizing ? 'max' : 'min', 'value of', testResults.optParamName,
    'by', testResults.method,
    (testResults.filterAscending === null ? 'filter off' : 'filter ascending' + testResults.filterAscending + ' value ' +
      testResults.filterValue + ' by ' + testResults.filterParamName),
    testResults.cycles, 'times')
  testResults.paramsNames = Object.keys(allRangeParams)

  // Get best init value and properties values
  let bestValue = null
  let bestPropVal = null
  ui.statusMessage('Get the best initial values.')
  const initRes = await getInitBestValues(testResults, allRangeParams)
  if(initRes && initRes.hasOwnProperty('bestValue') && initRes.bestValue !== null && initRes.hasOwnProperty('bestPropVal') && initRes.hasOwnProperty('data')) {
    testResults.initBestValue = initRes.bestValue
    bestValue = initRes.bestValue
    bestPropVal = initRes.bestPropVal
    testResults.perfomanceSummary.push(initRes.data)
    try {
      ui.statusMessage(`<p>From default and previus test. Best "${testResults.optParamName}": ${bestValue}</p>`)
      console.log('Saved best value', bestValue)
      console.log(testResults.perfomanceSummary)
    } catch {}
  }
  console.log('bestValue', bestValue)
  console.log('bestPropVal', bestPropVal)

  // Test strategy
  const optimizationState = {}
  let isEnd = false
  for(let i = 0; i < testResults.cycles; i++) {
    if (action.workerStatus === null) {
      console.log('Stop command detected')
      break
    }
    let optRes = {}
    switch(testResults.method) {
      case 'annealing':
        optRes = await optAnnealingIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState)
        break
      case 'sequential':
        optRes = await optSequentialIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState)
        if(optRes === null)
          isEnd = true
        break
      case 'random':
      default:
        optRes = await optRandomIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState)
        if(optRes === null)
          isEnd = true
    }
    if(isEnd)
      break
    if(optRes.hasOwnProperty('data') && optRes.hasOwnProperty('bestValue') && optRes.bestValue !== null && optRes.hasOwnProperty('bestPropVal')) {
      bestValue = optRes.bestValue
      bestPropVal = optRes.bestPropVal
      try {
        let text = `<p>Cycle: ${i + 1}/${testResults.cycles}. Best "${testResults.optParamName}": ${bestValue}</p>`
        text += optRes.hasOwnProperty('currentValue') ? `<p>Current "${testResults.optParamName}": ${optRes.currentValue}</p>` : ''
        text += optRes.error !== null  ? `<p style="color: red">${optRes.message}</p>` : optRes.message ? `<p>${optRes.message}</p>` : ''
        ui.statusMessage(text)
      } catch {}
    } else {
      try {
        let text = `<p>Cycle: ${i + 1}/${testResults.cycles}. Best "${testResults.optParamName}": ${bestValue}</p>`
        text += optRes.currentValue ? `<p>Current "${testResults.optParamName}": ${optRes.currentValue}</p>` : `<p>Current "${testResults.optParamName}": error</p>`
        text += optRes.error !== null  ? `<p style="color: red">${optRes.message}</p>` : optRes.message ? `<p>${optRes.message}</p>` : ''
        ui.statusMessage(text)
      } catch {}
    }
  }
  return testResults
}

async function getInitBestValues(testResults) { // TODO Add get current values(!) to startParams
  if(!testResults.hasOwnProperty('startParams') || !testResults.startParams.hasOwnProperty('current') || !testResults.startParams.current)
    return null

  let resVal =  null
  let resPropVal = testResults.startParams.current
  let resData = null

  function setBestVal (newVal, newPropVal, newResData) {
    if(resVal === null || resPropVal === null) {
      resVal = newVal
      resPropVal = newPropVal
      resData = newResData
    } else if(testResults.isMaximizing && newVal > resVal) {
      resVal = newVal
      resPropVal = newPropVal
      resData = newResData
    } else if(!testResults.isMaximizing && newVal < resVal) {
      resVal = newVal < resVal ? newVal : resVal
      resPropVal =  newVal < resVal ? newPropVal : resPropVal
      resData = newVal < resVal ?  newResData : resData
    }
  }

  resData = tv.parseReportTable()
  resData = calculateAdditionValuesToReport(resData)
  if (resData && resData.hasOwnProperty(testResults.optParamName)) {
    console.log(`Current "${testResults.optParamName}":`,  resData[testResults.optParamName])
    resVal = resData[testResults.optParamName]
    resData['comment'] = resData['comment'] ? `Current parameters. ${resData['comment']}` : 'Current parameters.'
    Object.keys(resPropVal).forEach(key => resData[`__${key}`] = resPropVal[key])
  }


  if(testResults.startParams.hasOwnProperty('default') && testResults.startParams.default) {
    const defPropVal = expandPropVal(testResults.startParams.default, resPropVal)
    if(resPropVal === null || Object.keys(resPropVal).some(key => resPropVal[key] !== defPropVal[key])) {
      const res = await getTestIterationResult(testResults, defPropVal, true) // Ignore error because propValues can be the same
      if(res && res.data && res.data.hasOwnProperty(testResults.optParamName)) {
        console.log(`Default "${testResults.optParamName}":`,  res.data[testResults.optParamName])
        res.data['comment'] = res.data['comment'] ? `Default parameters. ${res.data['comment']}` : 'Default parameters.'
        Object.keys(defPropVal).forEach(key => res.data[`__${key}`] = defPropVal[key])
        setBestVal(res.data[testResults.optParamName], defPropVal, res.data)
      }
    } else {
      console.log(`Default "${testResults.optParamName}" equal current:`, resData[testResults.optParamName])
    }
  }
  if(testResults.startParams.hasOwnProperty('best') && testResults.startParams.best) {
    if(resPropVal === null ||
      (
        (testResults.startParams.current && Object.keys(testResults.startParams.current).some(key => testResults.startParams.current[key] !== testResults.startParams.best[key])) &&
        (testResults.startParams.default && Object.keys(testResults.startParams.default).some(key => testResults.startParams.default[key] !== testResults.startParams.best[key]))
      )
    ) {
      const bestPropVal = expandPropVal(testResults.startParams.best, resPropVal)
      const res = await getTestIterationResult(testResults, bestPropVal, true)  // Ignore error because propValues can be the same
      if (res && res.data && res.data.hasOwnProperty(testResults.optParamName)) {
        console.log(`Best "${testResults.optParamName}":`, res.data[testResults.optParamName])
        res.data['comment'] = res.data['comment'] ? `Best value parameters. ${res.data['comment']}` : 'Best value parameters.'
        Object.keys(bestPropVal).forEach(key => res.data[`__${key}`] = bestPropVal[key])
        setBestVal(res.data[testResults.optParamName], bestPropVal, res.data)
      }

    } else {
      console.log(`Best "${testResults.optParamName}" equal previous (current or default):`, resData[testResults.optParamName])
    }
  }
  console.log(`For init "${testResults.optParamName}":`, resVal)

  if(resVal !== null && resPropVal !== null && resData !== null)
    return {bestValue: resVal, bestPropVal: resPropVal, data: resData}
  return null
}


async function getTestIterationResult (testResults, propVal, isIgnoreError = false) {
  let reportData = {}
  tv.isReportChanged = false // Global value
  const isParamsSet = await tv.setStrategyParams(testResults.shortName, propVal)
  if(!isParamsSet)
    return {error: 1, errMessage: 'The strategy parameters cannot be set', data: null}

  let isProcessStart = await page.waitForSelector(SEL.strategyReportInProcess, 1500)
  let isProcessEnd = tv.isReportChanged

  if (isProcessStart)
    isProcessEnd = await page.waitForSelector(SEL.strategyReportReady, 30000) // TODO to options
  else if (isProcessEnd)
    isProcessStart = true

  let isProcessError = document.querySelector(SEL.strategyReportError)
  await page.waitForTimeout(150) // Waiting for update digits. 150 is enough but 250 for reliable TODO Another way?
  reportData = tv.parseReportTable()
  if (!isProcessError && !isProcessEnd && testResults.perfomanceSummary.length) {
    const lastRes = testResults.perfomanceSummary[testResults.perfomanceSummary.length - 1] // (!) Previous value maybe in testResults.filteredSummary
    if(reportData.hasOwnProperty(testResults.optParamName) && lastRes.hasOwnProperty(testResults.optParamName) &&
      reportData[testResults.optParamName] !== lastRes[testResults.optParamName]) {
      isProcessEnd = true
      isProcessStart = true
    }
  }
  if((!isProcessError && isProcessEnd) || isIgnoreError) {
    reportData = calculateAdditionValuesToReport(reportData)
  }
  Object.keys(propVal).forEach(key => reportData[`__${key}`] = propVal[key])
  reportData['comment'] = isProcessError ? 'The tradingview error occurred when calculating the strategy based on these parameter values' :
    !isProcessStart ? 'The tradingview calculation process has not started for the strategy based on these parameter values'  :
      !isProcessEnd ? 'The calculation of the strategy parameters took more than 30 seconds for one combination. Testing of this combination is skipped.' : ''

  return {error: isProcessError ? 2 : !isProcessEnd ? 3 : null, message: reportData['comment'], data: reportData}
}

async function getResWithBestValue(res, testResults, bestValue, bestPropVal, propVale) {
  let isFiltered = false

  if(res.data.hasOwnProperty(testResults.optParamName)) {
    if(testResults.filterAscending !== null &&
      res.data.hasOwnProperty(testResults.filterParamName) && testResults.hasOwnProperty('filterValue')) {
      if(typeof res.data[testResults.filterParamName] !== 'number' ||
        (testResults.filterAscending && res.data[testResults.filterParamName] < testResults.filterValue) ||
        (!testResults.filterAscending  && res.data[testResults.filterParamName] > testResults.filterValue)
      ) {
        isFiltered = true
        res.data['comment'] = `Skipped for "${testResults.filterParamName}": ${res.data[testResults.filterParamName]}.${res.data['comment'] ? ' ' + res.data['comment'] : ''}`
        res.message = res.data['comment']
        res.isFiltered = true
      }
    }
    if(isFiltered)
      testResults.filteredSummary.push(res.data)
    else
      testResults.perfomanceSummary.push(res.data)
    await storage.setKeys(storage.STRATEGY_KEY_RESULTS, testResults)

    res.currentValue = res.data[testResults.optParamName]
    if(!isFiltered) {
      if(bestValue === null || typeof bestValue === 'undefined') {
        res.bestValue = res.data[testResults.optParamName]
        res.bestPropVal = propVale
        console.log(`Best value (first): ${bestValue} => ${res.bestValue}`)
      } else if(!isFiltered && testResults.isMaximizing) {
        res.bestValue = bestValue < res.data[testResults.optParamName] ? res.data[testResults.optParamName] : bestValue
        res.bestPropVal = bestValue < res.data[testResults.optParamName] ? propVale : bestPropVal
        if(bestValue < res.data[testResults.optParamName]) {
          res.isBestChanged = true
          console.log(`Best value max: ${bestValue} => ${res.bestValue}`)
        } else {
          res.isBestChanged = false
        }

      } else {
        res.bestValue = bestValue > res.data[testResults.optParamName] ? res.data[testResults.optParamName] : bestValue
        res.bestPropVal  = bestValue > res.data[testResults.optParamName] ? propVale : bestPropVal
        if(bestValue > res.data[testResults.optParamName]) {
          res.isBestChanged = true
          console.log(`Best value min: ${bestValue} => ${res.bestValue}`)
        } else {
          res.isBestChanged = false
        }
      }
    } else {
      res.isFiltered = true
    }
  } else {
    res.bestValue = bestValue
    res.bestPropVal = bestPropVal
    res.currentValue = 'error'
  }
  return res
}

function calculateAdditionValuesToReport(report) {
  if(!report.hasOwnProperty('Percent Profitable: All') || !typeof report['Percent Profitable: All']  === 'number' ||
    !report.hasOwnProperty('Ratio Avg Win / Avg Loss: All') || !typeof report['Ratio Avg Win / Avg Loss: All']  === 'number')
    return report
  // report['.Reward'] = report['Ratio Avg Win / Avg Loss: All'] * 100

  // TODO
  return report
}



function randomNormalDistribution(min, max) {
  let u = 0, v = 0;
  while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
  while(v === 0) v = Math.random();
  let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
  num = num / 10.0 + 0.5; // Translate to 0 -> 1
  if (num > 1 || num < 0)
    return randomNormalDistribution() // resample between 0 and 1
  else{
    num *= max - min // Stretch to fill range
    num += min // offset to min
  }
  return num
}

function randomInteger (min = 0, max = 10) {
  // min = Math.ceil(min);
  // max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Random optimization
async function optRandomIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState) {
  const propData = optRandomGetPropertiesValues(allRangeParams, bestPropVal)
  let propVal = propData.data

  if(bestPropVal)
    propVal = expandPropVal(propVal, bestPropVal)

  const res = await getTestIterationResult(testResults, propVal)
  if(!res || !res.data || res.error !== null)
    return res
  res.data['comment'] = res.data['comment'] ? res.data['comment'] + propData.message : propData.message
  if (!res.message)
    res.message = propData.message
  else
    res.message += propData.message
  return await getResWithBestValue(res, testResults, bestValue, bestPropVal, propVal)
}

function optRandomGetPropertiesValues(allRangeParams, curPropVal) {
  const propVal = {}
  let msg = ''
  const allParamNames = Object.keys(allRangeParams)
  if(curPropVal) {
    allParamNames.forEach(paramName => {
      propVal[paramName] = curPropVal[paramName]
    })
    const indexToChange = randomInteger(0, allParamNames.length - 1)
    const paramName = allParamNames[indexToChange]
    const curVal = propVal[paramName]
    const diffParams = allRangeParams[paramName].filter(paramVal => paramVal !== curVal)
    propVal[paramName] = diffParams.length === 0 ? curVal : diffParams.length === 1 ? diffParams[0] : diffParams[randomInteger(0, diffParams.length - 1)]
    msg = `Changed "${paramName}": ${curVal} => ${propVal[paramName]}.`
  } else {
    allParamNames.forEach(paramName => {
      propVal[paramName] = allRangeParams[paramName][randomInteger(0, allRangeParams[paramName].length - 1)]
    })
    msg = `Changed all parameters.`
  }
  return {message: msg, data: propVal}
}

function expandPropVal(propVal, basePropVal) {
  const newPropVal = {}
  Object.keys(basePropVal).forEach(key => {
    if(propVal.hasOwnProperty(key))
      newPropVal[key] = propVal[key]
    else
      newPropVal[key] = basePropVal[key]
  })
  return newPropVal
}






// Annealing optimization
async function optAnnealingIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState) {
  const initTemp = 1// TODO to param? Find teh best match?
  const isMaximizing = testResults.hasOwnProperty('isMaximizing') ? testResults.isMaximizing : true
  if (!optimizationState.isInit) {
    optimizationState.currentTemp = initTemp

    if(!bestPropVal || bestValue === 'undefined') {
      let propVal = optAnnealingNewState(allRangeParams) // Random value
      if(bestPropVal)
        propVal = expandPropVal(propVal, bestPropVal)
      optimizationState.lastState = propVal
      const res = await getTestIterationResult(testResults, optimizationState.lastState)
      if(!res || !res.data)
        return res

      optimizationState.lastEnergy = res.data[testResults.optParamName]
      optimizationState.bestState = optimizationState.lastState;
      optimizationState.bestEnergy = optimizationState.lastEnergy;
    } else {
      optimizationState.lastState = bestPropVal
      optimizationState.bestState = bestPropVal;
      optimizationState.lastEnergy = bestValue
      optimizationState.bestEnergy = bestValue
    }

    optimizationState.isInit = true
  }
  const iteration = testResults.perfomanceSummary.length


  let propData = optAnnealingNewState(allRangeParams, optimizationState.currentTemp, optimizationState.lastState)
  let propVal = propData.data
  if(bestPropVal)
    propVal = expandPropVal(propVal, bestPropVal)
  const currentState = propVal
  let res = await getTestIterationResult(testResults, currentState)

  if(!res || !res.data || res.error !== null)
    return res
  res.data['comment'] = res.data['comment'] ? res.data['comment'] + propData.message : propData.message
  if (!res.message)
    res.message = propData.message
  else
    res.message += propData.message
  // return await getResWithBestValue(res, testResults, bestValue, bestPropVal, propVal)
  res = await getResWithBestValue(res, testResults, bestValue, bestPropVal, propVal)
  if(!res.data.hasOwnProperty(testResults.optParamName))
    return res
  const currentEnergy = res.data[testResults.optParamName]

  if(res.hasOwnProperty('isBestChanged') && res.isBestChanged) {
    optimizationState.lastState = currentState;
    optimizationState.lastEnergy = currentEnergy;
    res.message += ` The best value ${res.bestValue}.`
  } else {
    const randVal = Math.random()
    const expVal = Math.exp(-(currentEnergy - optimizationState.lastEnergy)/optimizationState.currentTemp) // Math.exp(-10) ~0,000045,  Math.exp(-1) 0.3678 Math.exp(0); => 1
    // console.log('#', optimizationState.currentTemp, randVal, expVal, currentEnergy, optimizationState.lastEnergy, currentEnergy - optimizationState.lastEnergy)
    if (randVal <= expVal) { // TODO need to optimize
      optimizationState.lastState = currentState;
      optimizationState.lastEnergy = currentEnergy;
      // res.message += ' Randomly changed state to current.'
    } else { // To revert to best condition
      optimizationState.lastState = res.bestPropVal;
      optimizationState.lastEnergy = res.bestValue;
      // res.message += ` Returned to best state with best value ${res.bestValue}`
    }
  }
  optimizationState.currentTemp = optAnnealingGetTemp(optimizationState.currentTemp, testResults.cycles);
  // optimizationState.currentTemp = optAnnealingGetBoltzmannTemp(initTemp, iteration, Object.keys(allRangeParams).length);
  // optimizationState.currentTemp = optAnnealingGetExpTemp(initTemp, iteration, Object.keys(allRangeParams).length);
  return res
}

function optAnnealingGetTemp(prevTemperature, cylces) {
  return prevTemperature * (1-1/cylces);
}

function optAnnealingGetBoltzmannTemp(initTemperature, iter, cylces, dimensionSize) {
  return iter === 1 ? 1 : initTemperature/Math.log(1 + iter/(dimensionSize*2));
}

function optAnnealingGetExpTemp(initTemperature, iter, dimensionSize) {
  return initTemperature/Math.pow(iter, 1 / dimensionSize);
}

function optAnnealingNewState(allRangeParams, temperature, curState) {
  const propVal = {} // TODO prepare as
  let msg = ''
  const allParamNames = Object.keys(allRangeParams)
  const isAll = (randomInteger(0, 10) * temperature) >= 5
  if(!isAll && curState) {
    allParamNames.forEach(paramName => {
      propVal[paramName] = curState[paramName]
    })
    const indexToChange = randomInteger(0, allParamNames.length - 1)
    const paramName = allParamNames[indexToChange]
    const curVal = propVal[paramName]
    const diffParams = allRangeParams[paramName].filter(paramVal => paramVal !== curVal)

    if(diffParams.length === 0) {
      propVal[paramName] = curVal
    } else if(diffParams.length === 1) {
      propVal[paramName] = diffParams[0]
    } else {
      propVal[paramName] = diffParams[randomInteger(0, diffParams.length - 1)]

      // Is not proportional chances for edges of array
      // const offset = sign * Math.floor(temperature * randomNormalDistribution(0, (allRangeParams[paramName].length - 1)))
      // const newIndex = curIndex + offset > allRangeParams[paramName].length - 1 ? allRangeParams[paramName].length - 1 : // TODO +/-
      //   curIndex + offset < 0 ? 0 : curIndex + offset
      // propVal[paramName] = allRangeParams[paramName][newIndex]
      // Second variant
      const curIndex = allRangeParams[paramName].indexOf(curState[paramName])
      const sign = randomInteger(0,1) === 0 ? -1 : 1
      const baseOffset = Math.floor(temperature * randomNormalDistribution(0, (allRangeParams[paramName].length - 1)))
      const offsetIndex = (curIndex + sign * baseOffset) % (allRangeParams[paramName].length)
      const newIndex2 = offsetIndex >= 0 ? offsetIndex : allRangeParams[paramName].length + offsetIndex
      propVal[paramName] = allRangeParams[paramName][newIndex2]
    }
    msg = `Changed "${paramName}": ${curVal} => ${propVal[paramName]}.`
  }  else if (isAll) {
    allParamNames.forEach(paramName => {
      const curIndex = allRangeParams[paramName].indexOf(curState[paramName])
      const sign = randomInteger(0,1) === 0 ? -1 : 1
      const baseOffset = Math.floor(temperature * randomNormalDistribution(0, (allRangeParams[paramName].length - 1)))
      const offsetIndex = (curIndex + sign * baseOffset) % (allRangeParams[paramName].length)
      const newIndex2 = offsetIndex >= 0 ? offsetIndex : allRangeParams[paramName].length + offsetIndex
      propVal[paramName] = allRangeParams[paramName][newIndex2]
    })
    msg = `Changed all parameters randomly.`
  }  else {
    allParamNames.forEach(paramName => {
      propVal[paramName] = allRangeParams[paramName][randomInteger(0, allRangeParams[paramName].length - 1)]
    })
    msg = `Changed all parameters randomly without temperature.`
  }
  return {message: msg, data: propVal}
}

async function optAnnealingGetEnergy(testResults, propVal) { // TODO 2del test function annealing
  const allDimensionVal = Object.keys(propVal).map(name => Math.abs(propVal[name] * propVal[name] - 16))
  testResults.perfomanceSummary.push(allDimensionVal)
  const resData = {}
  resData[testResults.optParamName] = allDimensionVal.reduce((sum, item) => item + sum, 0)
  return {error: 0, data: resData};
}

async function optSequentialIteration(allRangeParams, testResults, bestValue, bestPropVal, optimizationState) {
  if (!optimizationState.hasOwnProperty('paramIdx')) {
    optimizationState.paramIdx = 0
  }
  let paramName = testResults.paramPriority[optimizationState.paramIdx]
  if (!optimizationState.hasOwnProperty('valIdx')) {
    optimizationState.valIdx = 0
  } else {
    optimizationState.valIdx += 1
    if(optimizationState.valIdx >= allRangeParams[paramName].length) {
      optimizationState.valIdx = 0
      optimizationState.paramIdx += 1
      if( optimizationState.paramIdx >= testResults.paramPriority.length) {
        return null // End
      } else {
        paramName = testResults.paramPriority[optimizationState.paramIdx]
      }
    }
  }
  const valIdx = optimizationState.valIdx


  const propVal = {}
  Object.keys(bestPropVal).forEach(paramName => {
    propVal[paramName] = bestPropVal[paramName]
  })
  propVal[paramName] = allRangeParams[paramName][valIdx]
  if(bestPropVal[paramName] === propVal[paramName])
    return {error: null, currentValue: bestValue, message: `The same value of the "${paramName}" parameter equal to ${propVal[paramName]} is skipped`}
  const msg = `Changed "${paramName}": ${bestPropVal[paramName]} => ${propVal[paramName]}.`

  const res = await getTestIterationResult(testResults, propVal)
  if(!res || !res.data || res.error !== null)
    return res
  res.data['comment'] = res.data['comment'] ? res.data['comment'] + msg : msg
  if (!res.message)
    res.message = msg
  else
    res.message += msg
  return await getResWithBestValue(res, testResults, bestValue, bestPropVal, propVal)
}