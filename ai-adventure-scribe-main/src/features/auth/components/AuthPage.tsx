/**
 * Authentication Page
 *
 * Simple login page that redirects to WorkOS AuthKit hosted UI.
 * WorkOS handles all authentication flows including signup, login, and password reset.
 */

import { Loader2, Sparkles } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const AuthPage: React.FC = () => {
  const handleSignIn = () => {
    // Redirect directly to backend auth endpoint
    // Backend will generate WorkOS URL and redirect
    const apiUrl = import.meta.env.VITE_API_URL || '';
    window.location.href = `${apiUrl}/v1/auth/login`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="flex items-center justify-center mb-4">
            <Sparkles className="h-12 w-12 text-purple-400" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">InfiniteRealms</h1>
          <p className="text-purple-200">Your World, Your Story, Forever</p>
        </div>

        <Card className="bg-white/10 backdrop-blur-md border-purple-500/30">
          <CardHeader>
            <CardTitle className="text-white text-center">Welcome, Adventurer</CardTitle>
            <CardDescription className="text-purple-200 text-center">
              Sign in or create an account to begin your quest
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handleSignIn}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white"
              size="lg"
            >
              Sign In / Sign Up
            </Button>

            <p className="text-xs text-purple-200/70 text-center">
              Powered by WorkOS AuthKit - Secure authentication with SSO support
            </p>
          </CardContent>
        </Card>

        <div className="text-center text-purple-200/60 text-sm">
          <p>New users will be prompted to create an account</p>
          <p className="mt-1">Existing users can sign in directly</p>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
