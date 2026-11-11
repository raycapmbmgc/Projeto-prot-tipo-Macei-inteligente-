import os,tempfile,unittest
from unittest.mock import patch
from pathlib import Path
os.environ['DATABASE_PATH']=str(Path(tempfile.mkdtemp())/'test.sqlite3')
import app
class ApiTests(unittest.TestCase):
 def test_database(self):
  c=app.app.test_client()
  response=c.get('/')
  self.assertEqual(response.status_code,200)
  response.close()
  self.assertEqual(c.get('/api/health').status_code,200)
  self.assertGreater(len(c.get('/api/hospitals').json),0)
  road=c.get('/api/roads').json[0]
  self.assertEqual(c.patch('/api/roads/'+road['id'],json={'status':'Bloqueada'}).status_code,200)
  self.assertEqual(c.get('/api/roads').json[0]['status'],'Bloqueada')
  self.assertEqual(c.patch('/api/roads/'+road['id'],json={'status':'inválido'}).status_code,400)
  self.assertEqual(c.post('/api/roads',json={'name':'Via de teste'}).status_code,201)
  self.assertEqual(c.get('/api/routes?lat=nan&lon=0&hospital_id=1').status_code,400)
  with patch('app.urlopen',side_effect=TimeoutError):
   self.assertEqual(c.get('/api/routes?lat=-9&lon=-35&hospital_id=1').status_code,502)
if __name__=='__main__':unittest.main()
