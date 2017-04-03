import { createElement } from 'react'
import ReactDOM from 'react-dom'
import mitt from 'mitt'
import HeadManager from './head-manager'
import { createRouter } from '../lib/router'
import App from '../lib/app'
import PageLoader from '../lib/page-loader'
import { loadGetInitialProps, getURL } from '../lib/utils'
import ErrorDebugComponent from '../lib/error-debug'

// Polyfill Promise globally
// This is needed because Webpack2's dynamic loading(common chunks) code
// depends on Promise.
// So, we need to polyfill it.
// See: https://github.com/webpack/webpack/issues/4254
if (!window.Promise) {
  window.Promise = Promise
}

const {
  __NEXT_DATA__: {
    props,
    err,
    pathname,
    query
  },
  location
} = window

// create a pageLoader and attach it to __NEXT_DATA__
export const pageLoader = new PageLoader(window.__NEXT_DATA__)
window.__NEXT_DATA__.pageLoader = pageLoader

let lastAppProps
export const router = createRouter(pathname, query, getURL(), {
  pageLoader,
  err
})

const headManager = new HeadManager()
const appContainer = document.getElementById('__next')
const errorContainer = document.getElementById('__next-error')

export default () => {
  const emitter = mitt()
  const hash = location.hash.substring(1)

  if (err) {
    const errorComponentLoaded = pageLoader.onPageLoaded('/_error', (Component) => {
      render({ Component, props, hash, err, emitter })
      errorComponentLoaded()
    })
  } else {
    const componentLoaded = pageLoader.onPageLoaded(pathname, (Component) => {
      render({ Component, props, hash, err, emitter })
      componentLoaded()
    })
  }

  // trigger mounting of the component for this route
  pageLoader.mountPageBundle(pathname)
  // trigger mounting of the error component as well
  pageLoader.mountPageBundle('/_error')
  // subscribe to any route changes, and render
  router.subscribe(({ Component, props, hash, err }) => {
    render({ Component, props, err, hash, emitter })
  })

  return emitter
}

export async function render (props) {
  if (props.err) {
    lastAppProps = props
    await renderError(props.err, props.Component)
    return
  }

  try {
    await doRender(props)
  } catch (err) {
    if (err.abort) return
    await renderError(err)
  }
}

// This method handles all runtime and debug errors.
// 404 and 500 errors are special kind of errors
// and they are still handle via the main render method.
export async function renderError (error, ErrorComponent) {
  const prod = process.env.NODE_ENV === 'production'
  // We need to unmount the current app component because it's
  // in the inconsistent state.
  // Otherwise, we need to face issues when the issue is fixed and
  // it's get notified via HMR
  ReactDOM.unmountComponentAtNode(appContainer)

  const errorMessage = `${error.message}\n${error.stack}`
  console.error(errorMessage)

  if (prod) {
    const initProps = { err: error, pathname, query }
    const props = await loadGetInitialProps(ErrorComponent, initProps)
    ReactDOM.render(createElement(ErrorComponent, props), errorContainer)
  } else {
    ReactDOM.render(createElement(ErrorDebugComponent, { error }), errorContainer)
  }
}

async function doRender ({ Component, props, hash, err, emitter }) {
  if (!props && Component && lastAppProps.err && !err) {
    // fetch props if ErrorComponent was replaced with a page component by HMR
    const { pathname, query } = router
    props = await loadGetInitialProps(Component, { err, pathname, query })
  }

  if (emitter) {
    emitter.emit('before-reactdom-render', { Component })
  }

  Component = Component || lastAppProps.Component
  props = props || lastAppProps.props

  const appProps = { Component, props, hash, err, router, headManager }
  // lastAppProps has to be set before ReactDom.render to account for ReactDom throwing an error.
  lastAppProps = appProps

  // We need to clear any existing runtime error messages
  ReactDOM.unmountComponentAtNode(errorContainer)
  ReactDOM.render(createElement(App, appProps), appContainer)

  if (emitter) {
    emitter.emit('after-reactdom-render', { Component })
  }
}
