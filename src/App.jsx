import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import { Button } from '@/components/ui/button';
// Add page imports here
import Home from './pages/Home';

const AuthenticatedApp = () => {
  const {
    user,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    navigateToLogin,
    checkAppState,
  } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  if (authError && authError.type !== 'auth_required') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Unable to verify access</h1>
          <p className="mt-2 text-sm text-slate-600">{authError.message}</p>
          <Button className="mt-5" onClick={checkAppState}>Try again</Button>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Sign in required</h1>
          <p className="mt-2 text-sm text-slate-600">
            MathMesh Governor is restricted to authorized app administrators.
          </p>
          <Button className="mt-5" onClick={() => navigateToLogin()}>
            Sign in with Base44
          </Button>
        </section>
      </main>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Administrator access required</h1>
          <p className="mt-2 text-sm text-slate-600">
            This app contains operator controls and sensitive run data. Contact an app administrator if you need access.
          </p>
        </section>
      </main>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App