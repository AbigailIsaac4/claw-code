from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import sys

class MockSandbox(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        print(f"POST {self.path}")
        print(f"Body: {body.decode('utf-8')}")
        sys.stdout.flush()
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        if "/command" in self.path:
            self.wfile.write(b"event: result\ndata: {\"exitCode\": 0}\n\n")
        elif "sandboxes" in self.path:
            self.wfile.write(b"{\"id\":\"test-id\"}")

    def do_GET(self):
        print(f"GET {self.path}")
        sys.stdout.flush()
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(b"{\"endpoint\":\"127.0.0.1:8081/\"}")

if __name__ == "__main__":
    server = HTTPServer(('127.0.0.1', 8081), MockSandbox)
    print("Mock running on 8081")
    server.serve_forever()
